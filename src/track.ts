import path from 'path'
import { promises as fsp } from 'fs'
import { ServerAPI, history } from '@signalk/server-api'
import { Temporal } from '@js-temporal/polyfill'
import { spawn } from 'child_process'

type Context = history.ValuesRequest['context']
type Path = history.PathSpec['path']
type DataRow = history.DataRow

interface GeoJSONFeature {
  type: 'Feature'
  properties: {
    startTime: string
    endTime: string
    resolution: string
    pointCount: number
  }
  geometry: {
    type: 'MultiLineString'
    coordinates: number[][][]
  }
}

/** Generate track GeoJSON from history data */
export async function generateTrackGeoJSON(
  server: ServerAPI,
  chartPath: string,
  startDateStr: string,
  endDateStr: string,
  resolution: string
): Promise<{ filename: string; featureCount: number }> {
  if (!server.getHistoryApi) {
    throw new Error('History API not available')
  }

  // Parse dates
  const startDate = new Date(startDateStr)
  const endDate = new Date(endDateStr)

  // Calculate time segments based on resolution
  const resolutionMs = getResolutionInMs(resolution)
  const timeSegments: Array<{ from: Date; to: Date }> = []

  let currentTime = new Date(startDate)
  while (currentTime < endDate) {
    const segmentEnd = new Date(
      Math.min(currentTime.getTime() + resolutionMs, endDate.getTime())
    )
    timeSegments.push({ from: new Date(currentTime), to: segmentEnd })
    currentTime = segmentEnd
  }

  server.debug(`Processing ${timeSegments.length} time segments`)

  // Collect all position data
  const features: GeoJSONFeature[] = []

  for (const segment of timeSegments) {
    try {
      // Convert dates to Temporal.Instant
      const fromInstant = Temporal.Instant.fromEpochMilliseconds(
        segment.from.getTime()
      )
      const toInstant = Temporal.Instant.fromEpochMilliseconds(
        segment.to.getTime()
      )

      // Query history API with 10 second resolution
      const historyApi = await server.getHistoryApi()
      const response = await historyApi.getValues({
        duration: undefined as never,
        from: fromInstant,
        to: toInstant,
        context: 'vessels.self' as unknown as Context,
        resolution: 10, // 10 seconds
        pathSpecs: [
          {
            path: 'navigation.position' as unknown as Path,
            aggregate: 'average'
          }
        ]
      })

      if (response.data && response.data.length > 0) {
        const lineSegments = processPositionData(response.data)

        if (lineSegments.length > 0) {
          features.push({
            type: 'Feature',
            properties: {
              startTime: segment.from.toISOString(),
              endTime: segment.to.toISOString(),
              resolution: resolution,
              pointCount: response.data.length
            },
            geometry: {
              type: 'MultiLineString',
              coordinates: lineSegments
            }
          })
        }
      }
    } catch (error) {
      server.debug(
        `Error fetching data for segment ${segment.from.toISOString()}: ${
          (error as Error).message
        }`
      )
      // Continue with next segment
    }
  }

  // Create GeoJSON FeatureCollection
  const geojson = {
    type: 'FeatureCollection',
    features: features
  }

  // Generate filename
  const startStr = startDateStr.replace(/:/g, '-')
  const endStr = endDateStr.replace(/:/g, '-')
  const filename = `track_${startStr}_to_${endStr}.geojson`
  const filepath = path.join(chartPath, filename)

  // Write GeoJSON file
  await fsp.writeFile(filepath, JSON.stringify(geojson, null, 2), 'utf-8')

  server.debug(
    `Generated track GeoJSON: ${filepath} with ${features.length} features`
  )

  // Convert GeoJSON to PMTiles using Docker
  const pmtilesFilename = filename.replace('.geojson', '.pmtiles')
  try {
    await convertGeoJSONToPMTiles(server, chartPath, filename, pmtilesFilename)

    // Remove the GeoJSON file after successful conversion
    await fsp.unlink(filepath)
    server.debug(`Removed temporary GeoJSON file: ${filepath}`)

    return {
      filename: pmtilesFilename,
      featureCount: features.length
    }
  } catch (error) {
    server.error(`Failed to convert to PMTiles: ${(error as Error).message}`)
    // Return GeoJSON filename if conversion fails
    return {
      filename: filename,
      featureCount: features.length
    }
  }
}

/** Convert GeoJSON to PMTiles using Docker */
async function convertGeoJSONToPMTiles(
  server: ServerAPI,
  chartPath: string,
  geojsonFilename: string,
  pmtilesFilename: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    server.debug(
      `Converting ${geojsonFilename} to ${pmtilesFilename} using Docker`
    )

    const dockerArgs = [
      'run',
      '-i',
      '--rm',
      '-v',
      `${chartPath}:/data`,
      'versatiles/versatiles-tippecanoe:latest',
      '-o',
      `/data/${pmtilesFilename}`,
      '-f',
      `/data/${geojsonFilename}`,
      '-z17'
    ]

    const docker = spawn('docker', dockerArgs)

    let stdout = ''
    let stderr = ''

    docker.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    docker.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    docker.on('close', (code) => {
      if (code === 0) {
        server.debug(`Successfully converted to PMTiles: ${pmtilesFilename}`)
        if (stdout) server.debug(`Docker stdout: ${stdout}`)
        resolve()
      } else {
        const errorMsg = `Docker conversion failed with exit code ${code}${
          stderr ? `: ${stderr}` : ''
        }`
        server.error(errorMsg)
        reject(new Error(errorMsg))
      }
    })

    docker.on('error', (error) => {
      const errorMsg = `Failed to spawn docker process: ${error.message}`
      server.error(errorMsg)
      reject(new Error(errorMsg))
    })
  })
}

/** Process position data into line segments, breaking on gaps > 2 minutes */
function processPositionData(data: DataRow[]): number[][][] {
  const lineSegments: number[][][] = []
  let currentSegment: number[][] = []

  const MAX_GAP_MS = 2 * 60 * 1000 // 2 minutes in milliseconds
  let lastTimestamp: Date | null = null

  for (const row of data) {
    const timestamp = new Date(row[0])
    const position = row[1]

    // Skip if no valid position data
    if (
      !position ||
      typeof position[0] !== 'number' ||
      typeof position[1] !== 'number'
    ) {
      continue
    }

    const [longitude, latitude] = position || []

    // Check for time gap
    if (
      lastTimestamp &&
      timestamp.getTime() - lastTimestamp.getTime() > MAX_GAP_MS
    ) {
      // Save current segment and start a new one
      if (currentSegment.length > 1) {
        lineSegments.push(currentSegment)
      }
      currentSegment = []
    }

    // Add point to current segment [longitude, latitude]
    currentSegment.push([longitude, latitude])
    lastTimestamp = timestamp
  }

  // Add final segment
  if (currentSegment.length > 1) {
    lineSegments.push(currentSegment)
  }

  return lineSegments
}

/** Convert resolution string to milliseconds */
function getResolutionInMs(resolution: string): number {
  switch (resolution) {
    case 'hour':
      return 60 * 60 * 1000
    case 'day':
      return 24 * 60 * 60 * 1000
    case 'week':
      return 7 * 24 * 60 * 60 * 1000
    case 'month':
      return 30 * 24 * 60 * 60 * 1000 // Approximate
    case 'year':
      return 365 * 24 * 60 * 60 * 1000 // Approximate
    default:
      return 24 * 60 * 60 * 1000 // Default to day
  }
}
