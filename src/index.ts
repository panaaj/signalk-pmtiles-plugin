import path from 'path'
import * as _ from 'lodash'
import { ChartProvider } from './types'
import { Request, Response, Application } from 'express'
import {
  Plugin,
  ServerAPI,
  ResourceProviderRegistry
} from '@signalk/server-api'
import { access, mkdirSync, Dirent, promises as fsp, constants } from 'fs'
import { getMetadata, openPMTilesFile } from './pmtiles'
import { generateTrackGeoJSON } from './track'

interface Config {
  chartPath: string
}

interface ChartProviderApp
  extends ServerAPI,
    ResourceProviderRegistry,
    Application {
  config: {
    ssl: boolean
    configPath: string
    version: string
    getExternalPort: () => number
  }
}

export const PMTILES = '/signalk/pmtiles/'
const apiRoutePrefix = {
  1: '/signalk/v1/api/resources',
  2: '/signalk/v2/api/resources'
}

module.exports = (server: ChartProviderApp): Plugin => {
  let chartProviders: { [key: string]: ChartProvider } = {}
  //let pluginStarted = false
  let props: Config = {
    chartPath: ''
  }

  const configBasePath = server.config.configPath
  const defaultChartsPath = path.join(configBasePath, '/charts/pmtiles')
  const serverMajorVersion = parseInt(server.config.version.split('.')[0])
  const CONFIG_SCHEMA = {
    title: 'PMTiles Charts',
    type: 'object',
    properties: {
      chartPath: {
        type: 'string',
        title: 'Path to Chart Files',
        description: `Enter path relative to "${configBasePath}". Defaults to "${defaultChartsPath}"`
      }
    }
  }
  const CONFIG_UISCHEMA = {}

  // ******** REQUIRED PLUGIN DEFINITION *******
  const plugin: Plugin = {
    id: 'pmtiles-chart-provider',
    name: 'PMTiles Chart provider',
    schema: () => CONFIG_SCHEMA,
    uiSchema: () => CONFIG_UISCHEMA,
    registerWithRouter: (router) => {
      server.debug('** Registering custom routes with router **')

      // Check if History API is available
      router.get('/check-history-api', async (req: Request, res: Response) => {
        server.debug(`GET /check-history-api`)
        try {
          if (!server.getHistoryApi) {
            return res.json({ available: false })
          }
          await server.getHistoryApi()
          res.json({
            available: true
          })
        } catch (error) {
          res.json({
            available: false
          })
        }
      })

      // Handle track chart generation
      router.post('/generate-track', async (req: Request, res: Response) => {
        server.debug(`POST /generate-track`)
        try {
          const { startDate, endDate, resolution } = req.body

          // Validate input
          if (!startDate || !endDate || !resolution) {
            return res.status(400).json({
              error: 'Missing required fields: startDate, endDate, resolution'
            })
          }

          const validResolutions = ['hour', 'day', 'week', 'month', 'year']
          if (!validResolutions.includes(resolution)) {
            return res.status(400).json({
              error: `Invalid resolution. Must be one of: ${validResolutions.join(
                ', '
              )}`
            })
          }

          // Validate dates
          const start = new Date(startDate)
          const end = new Date(endDate)

          if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return res.status(400).json({
              error: 'Invalid date format'
            })
          }

          if (start > end) {
            return res.status(400).json({
              error: 'Start date must be before end date'
            })
          }

          server.debug(
            `Generating track chart: ${startDate} to ${endDate}, resolution: ${resolution}`
          )

          // Check if history API is available
          try {
            if (!server.getHistoryApi) {
              return res.status(503).json({
                error:
                  'History API not available. Make sure a history plugin is installed and enabled.'
              })
            }
            await server.getHistoryApi()
          } catch (error) {
            return res.status(503).json({
              error:
                'History API not available. Make sure a history plugin is installed and enabled.'
            })
          }

          // Get chart path
          let chartPath: string
          if (!props.chartPath) {
            chartPath = defaultChartsPath
          } else {
            chartPath = path.resolve(configBasePath, props.chartPath)
          }

          // Generate track asynchronously
          generateTrackGeoJSON(
            server,
            chartPath,
            startDate,
            endDate,
            resolution
          )
            .then((result: { filename: string; featureCount: number }) => {
              res.json({
                success: true,
                message: `Track chart generated successfully`,
                filename: result.filename,
                features: result.featureCount,
                startDate,
                endDate,
                resolution
              })
            })
            .catch((error: Error) => {
              server.error(`Error generating track: ${error.message}`)
              res.status(500).json({
                error: `Failed to generate track: ${error.message}`
              })
            })
        } catch (error) {
          server.error(
            `Error generating track chart: ${(error as Error).message}`
          )
          res.status(500).json({
            error: 'Internal server error while generating track chart'
          })
        }
      })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    start: (settings: any) => {
      doStartup(settings)
    },
    stop: () => {
      server.setPluginStatus('stopped')
    }
  }

  const doStartup = async (config: Config) => {
    server.debug('** starting..... **')
    server.debug(`*** Loaded Configuration: ${JSON.stringify(config)}`)
    if (Number(process.versions.node.split('.')[0]) < 18) {
      console.log(
        `Unsupported NodeJS version: ${process.versions.node}.\n Requires version 18.0.0 or later.`
      )
      server.setPluginError('Requires NodeJS verion >= 18.0.0.')
      return
    }

    props = { ...config }

    let chartPath: string
    if (!props.chartPath) {
      checkChartPath(defaultChartsPath)
      chartPath = defaultChartsPath
    } else {
      chartPath = path.resolve(configBasePath, props.chartPath)
    }

    server.debug(`Start charts plugin. Chart path: ${chartPath}`)

    registerRoutes()

    const urlBase = `${server.config.ssl ? 'https' : 'http'}://localhost:${
      server.config.getExternalPort() || 3000
    }`
    server.debug(`**urlBase** ${urlBase}`)
    server.setPluginStatus('Started')

    /** Find charts (Note: Router paths must be active!) */
    scanForCharts(chartPath, urlBase)
      .then((charts: { [key: string]: ChartProvider }) => {
        server.debug(
          `Chart plugin: Found ${
            _.keys(charts).length
          } charts from ${chartPath}`
        )
        chartProviders = _.merge({}, charts)
        // populate provider metadata
        getMetadata(chartProviders)
      })
      .catch((e: Error) => {
        const msg = `Error loading chart providers!`
        console.error(msg, e.message)
        chartProviders = {}
        server.setPluginError(msg)
      })
  }

  /** Register router paths */
  const registerRoutes = () => {
    server.debug('** Registering API paths **')

    // v1 routes
    server.get(
      apiRoutePrefix[1] + '/charts/:identifier',
      (req: Request, res: Response) => {
        const { identifier } = req.params
        const provider = chartProviders[identifier]
        if (provider) {
          return res.json(cleanChartProvider(provider))
        } else {
          return res.status(404).send('Not found')
        }
      }
    )

    server.get(apiRoutePrefix[1] + '/charts', (req: Request, res: Response) => {
      const sanitized = _.mapValues(chartProviders, (provider) =>
        cleanChartProvider(provider)
      )
      res.json(sanitized)
    })

    // v2 routes
    if (serverMajorVersion === 2) {
      server.debug('** Registering v2 API paths **')
      registerAsProvider()
    }

    // list PMTiles files
    server.get(`${PMTILES}`, (req: Request, res: Response) => {
      server.debug(`GET ${PMTILES}`)
      res.json(Object.keys(chartProviders))
    })

    // routes to fetch PMTiles file contents
    server.get(`${PMTILES}:identifier`, (req: Request, res: Response) => {
      server.debug(`GET ${PMTILES}${req.params.identifier}`)
      const { identifier } = req.params
      const provider = chartProviders[identifier]
      if (provider) {
        res.sendFile(provider._filePath)
      } else {
        res.status(404).send('Not found')
      }
    })
  }

  /** Register Signal K server Resources API provider */
  const registerAsProvider = () => {
    server.debug('** Registering as Resource Provider for `charts` **')
    try {
      server.registerResourceProvider({
        type: 'charts',
        methods: {
          listResources: (params: {
            [key: string]: number | string | object | null
          }) => {
            server.debug(`** listResources() ${params}`)
            return Promise.resolve(
              _.mapValues(chartProviders, (provider) =>
                cleanChartProvider(provider, 2)
              )
            )
          },
          getResource: (id: string) => {
            server.debug(`** getResource() ${id}`)
            const provider = chartProviders[id]
            if (provider) {
              return Promise.resolve(cleanChartProvider(provider, 2))
            } else {
              return Promise.reject(new Error('Chart not found!'))
            }
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setResource: (id: string, value: any) => {
            return Promise.reject(
              new Error(`Not implemented!\n Cannot set ${id} to ${value}`)
            )
          },
          deleteResource: (id: string) => {
            return Promise.reject(
              new Error(`Not implemented!\n Cannot delete ${id}`)
            )
          }
        }
      })
    } catch (error) {
      server.debug('Failed Provider Registration!')
    }
  }

  return plugin
}

/** Format chart data returned to the requestor. */
const cleanChartProvider = (provider: ChartProvider, version = 1) => {
  let v
  if (version === 1) {
    v = _.merge({}, provider.v1)
    v.tilemapUrl = v.tilemapUrl.replace('~basePath~', apiRoutePrefix[1])
  } else if (version === 2) {
    v = _.merge({}, provider.v2)
    v.url = v.url ? v.url.replace('~basePath~', apiRoutePrefix[2]) : ''
  }
  provider = _.omit(provider, [
    '_filePath',
    '_fileFormat',
    '_pmtilesHandle',
    'v1',
    'v2'
  ]) as ChartProvider
  return _.merge(provider, v)
}

/** Check chart path exists. Create it if it doesn't. */
const checkChartPath = (path: string) => {
  access(path, constants.R_OK, () => {
    console.log(`**** path ${path} not found!... creating it....`)
    mkdirSync(path, { recursive: true })
  })
}

/** Process chart files in provided path. */
const scanForCharts = async (
  chartBaseDir: string,
  urlBase: string
): Promise<{ [key: string]: ChartProvider }> => {
  try {
    const files = await fsp.readdir(chartBaseDir, { withFileTypes: true })

    const charts: Array<ChartProvider | null> = files
      .map((file: Dirent) => {
        if (file.name.match(/\.pmtiles$/i)) {
          return openPMTilesFile(chartBaseDir, file.name, urlBase)
        } else {
          return null
        }
      })
      .filter((entry: ChartProvider | null) => {
        return entry
      })
    const result: { [key: string]: ChartProvider } = {}
    _.reduce(
      charts as ChartProvider[],
      (entry: { [key: string]: ChartProvider }, chart: ChartProvider) => {
        entry[chart.identifier] = chart
        return entry
      },
      result
    )
    return result
  } catch (err) {
    console.error(
      `Error reading charts directory ${chartBaseDir}:${(err as Error).message}`
    )
    return {}
  }
}
