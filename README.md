# ProtoMaps (PMTiles) Chart provider for Signal K server

Signal K Node server `resource-provider` plugin enabling support for PMTiles map files.

Read more about PMTiles here: [ProtoMaps](https://protomaps.com/docs/pmtiles)

To convert MBTiles to PMTiles use the [go-pmtiles](https://github.com/protomaps/go-pmtiles/releases) utility.


### Usage

1. Install `signalk-pmtiles-plugin` from Appstore using Signal K server admin console

1. Locate `PMTiles Chart provider` in **Plugin Config** screen

1. Add "Chart paths" in plugin configuration. Defaults to `${signalk-configuration-path}/charts`

1. Place PMTiles chart files into configured path

1. Enable plugin

Chart metadata is available to client apps at the following paths:

| Server Version | API | Path |
|--- |--- |--- |
| 1.x.x | v1 | `/signalk/v1/api/resources/charts` |
| 2.x.x | v2 | `/signalk/v2/api/resources/charts` |

_**Note: [Freeboard SK](https://www.npmjs.com/package/@signalk/freeboard-sk) v2 or later supports PMTiles charts.**_

---

## Sytem Requirements

`Signal K` server running on `NodeJS` v18 (or later).
