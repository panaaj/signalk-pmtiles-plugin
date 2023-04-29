import * as bluebird from 'bluebird'
import path from 'path'
import * as _ from 'lodash'
import { ChartProvider } from './types'
import { Request, Response, Application } from 'express'
import {
  Plugin,
  PluginServerApp,
  ResourceProviderRegistry
} from '@signalk/server-api'
import { access, mkdirSync, Dirent, promises as fsp, constants } from 'fs'
import { getMetadata, openPMTilesFile } from './pmtiles'

interface Config {
  chartPath: string
}

interface ChartProviderApp
  extends PluginServerApp,
    ResourceProviderRegistry,
    Application {
  statusMessage?: () => string
  error: (msg: string) => void
  debug: (...msg: unknown[]) => void
  setPluginStatus: (pluginId: string, status?: string) => void
  setPluginError: (pluginId: string, status?: string) => void
  config: {
    ssl: boolean
    configPath: string
    version: string
    getExternalPort: () => number
  }
}

export const PMTILES = '/pmtiles/'
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    start: (settings: any) => {
      doStartup(settings)
    },
    stop: () => {
      server.setPluginStatus('stopped')
    }
  }

  const doStartup = async (config: Config) => {

    if (Number(process.versions.node.split('.')[0]) < 18) {
      console.log(`Unsupported NodeJS version: ${process.versions.node}.\n Requires version 18.0.0 or later.`)
      server.setPluginError('Requires NodeJS verion >= 18.0.0.')
      return
    }

    server.debug('** loaded config: ', config)
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
    server.debug('**urlBase**', urlBase)
    server.setPluginStatus('Started')

    // populate PMTiles metadata (requires router paths to be active)
    const loadProviders = bluebird
      .mapSeries([chartPath], (cPath: string) =>
        scanForCharts(cPath, urlBase)
      )
      .then((list: ChartProvider[]) =>
        _.reduce(list, (result, charts) => _.merge({}, result, charts), {})
      )

      return loadProviders
      .then((charts: { [key: string]: ChartProvider }) => {
        server.debug(
          `Chart plugin: Found ${
            _.keys(charts).length
          } charts from ${chartPath}`
        )
        chartProviders = _.merge({}, charts)
        getMetadata(chartProviders)
      })
      .catch((e: Error) => {
        console.error(`Error loading chart providers`, e.message)
        chartProviders = {}
        server.setPluginError(`Error loading chart providers`)
      })
  }

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

  // Resources API provider registration
  const registerAsProvider = () => {
    server.debug('** Registering as Resource Provider for `charts` **')
    try {
      server.registerResourceProvider({
        type: 'charts',
        methods: {
          listResources: (params: {
            [key: string]: number | string | object | null
          }) => {
            server.debug(`** listResources()`, params)
            return Promise.resolve(
              _.mapValues(chartProviders, (provider) =>
              cleanChartProvider(provider, 2)
              )
            )
          },
          getResource: (id: string) => {
            server.debug(`** getResource()`, id)
            const provider = chartProviders[id]
            if (provider) {
              return Promise.resolve(cleanChartProvider(provider, 2))
            } else {
              throw new Error('Chart not found!')
            }
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setResource: (id: string, value: any) => {
            throw new Error(`Not implemented!\n Cannot set ${id} to ${value}`)
          },
          deleteResource: (id: string) => {
            throw new Error(`Not implemented!\n Cannot delete ${id}`)
          }
        }
      })
    } catch (error) {
      server.debug('Failed Provider Registration!')
    }
  }

  return plugin
}

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

const checkChartPath = (path: string) => {
  access(path, constants.R_OK, () => {
    console.log(`**** path ${path} not found!... creating it....`)
    mkdirSync(path, {recursive: true})
  })
}

const scanForCharts = async (chartBaseDir: string, urlBase: string) => {
  try {
   const files = await fsp.readdir(chartBaseDir, { withFileTypes: true })
   const result = await bluebird.mapSeries(files, (file: Dirent) => {
      if (file.name.match(/\.pmtiles$/i)) {
        return openPMTilesFile(chartBaseDir, file.name, urlBase)
      } else {
        return Promise.resolve(null)
      }
    })
    const charts: ChartProvider[] =_.filter(result, _.identity)
    return _.reduce(
      charts,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result: any, chart: ChartProvider) => {
        result[chart.identifier] = chart
        return result
      },
      {}
    )
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  catch (err: any) {
    console.error(
      `Error reading charts directory ${chartBaseDir}:${err.message}`
    )
  }
}
