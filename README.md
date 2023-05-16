# ProtoMaps (PMTiles) Chart provider for Signal K server

Signal K Node server `resource provider` plugin enabling the use of PMTiles map files.

_**Note: Requires `Signal K` server running on `NodeJS` v18 or later!**_

---

PMTiles is a single-file archive for pyramids of tiled data that can be hosted on simple storage and does not require a database (eg. SQLite) to be installed.

Your MBTiles files can be easily converted to PMTiles using the [go-pmtiles](https://github.com/protomaps/go-pmtiles/releases) utility.

Read more about PMTiles here: [ProtoMaps](https://protomaps.com/docs/pmtiles)

---

The plugin supports the Signal K server v2 Resources API and can be used in conjunction with other chart `resource provider` plugins.

Chart metadata is made available to client apps via both v1 and v2 API paths.

_Note: [Freeboard-SK](https://www.npmjs.com/package/@signalk/freeboard-sk) v2 or later supports the use of PMTiles charts._

| Server Version | API | Path |
|--- |--- |--- |
| 1.x.x | v1 | `/signalk/v1/api/resources/charts` |
| 2.x.x | v2 | `/signalk/v2/api/resources/charts` |

_Example: `/signalk/v2/api/resources/charts`_
```JSON
{
	"kvarken.pmtiles": {
		"identifier": "kvarken.pmtiles",
		"name": "kvarken.pmtiles",
		"description": "",
		"type": "tilelayer",
		"scale": 250000,
		"minzoom": 3,
		"maxzoom": 17,
		"bounds": [17.899475, 62.6097716, 23.0905151, 63.8346133],
		"format": "png",
		"url": "/pmtiles/kvarken.pmtiles",
		"layers": []
	}
}
```

_Example: `/signalk/v1/api/resources/charts`_
```
{
	"kvarken.pmtiles": {
		"identifier": "kvarken.pmtiles",
		"name": "kvarken.pmtiles",
		"description": "",
		"type": "tilelayer",
		"scale": 250000,
		"minzoom": 3,
		"maxzoom": 17,
		"bounds": [17.899475, 62.6097716, 23.0905151, 63.8346133],
		"format": "png",
		"tilemapUrl": "/pmtiles/kvarken.pmtiles",
		"chartLayers": []
	}
}
```

The plugin also creates a path from which map tile data is served `/pmtiles`.

Visiting this url will display a list of discovered PMTiles files _(.pmtiles)_ in the location provided in the `Plugin Config` screen.

```
["kvarken.pmtiles","NBottenv.pmtiles"]
```

---
### Usage

1. Install `signalk-pmtiles-plugin` from the **Appstore** screen in the Signal K server admin console

1. Once installed, restart the server and the locate `PMTiles Chart provider` in the **Plugin Config** screen

1. Enter the path to the folder in which you will store .pmtiles files in `Path to chart files`. _Note: If omitted the path will default to `.signalk/charts/pmtiles`_

1. Click **Submit** to save the changes.

1. Place your chart files _(.pmtiles)_ into folder entered in the previous step

1. **Enable** plugin

---

## System Requirements

- `Signal K` server running on `NodeJS` v18 (or later).
