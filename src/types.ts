import { PMTiles } from 'pmtiles'

export interface ChartProvider {
  _fileFormat?: 'pmtiles'
  _filePath: string
  _pmtilesHandle?: PMTiles
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _flipY_?: any
  identifier: string
  name: string
  description: string
  type: 'tilelayer'
  scale: number
  v1?: {
    tilemapUrl: string
    chartLayers: string[]
  }
  v2?: {
    url: string
    layers: string[]
  }
  bounds?: number[]
  minzoom?: number
  maxzoom?: number
  format?: string
  layers?: string[]
}
