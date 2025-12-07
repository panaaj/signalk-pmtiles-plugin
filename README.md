# ProtoMaps (PMTiles) Chart provider for Signal K server

Signal K Node server `resource provider` plugin enabling the use of ProtoMaps _(.pmtiles)_ map files.

---

PMTiles is a single-file archive for pyramids of tiled data that can be hosted on simple storage and does not require a database (eg. SQLite) to be installed.

Your MBTiles files can be easily converted to PMTiles using the [go-pmtiles](https://github.com/protomaps/go-pmtiles/releases) utility.

Read more about PMTiles here: [ProtoMaps](https://protomaps.com/docs/pmtiles)

---

This plugin supports the Signal K server v2 Resources API and can be used in conjunction with other chart `resource provider` plugins.

Additionally, it provides a UI to enable the creation of PMTiles vector charts containing your vessel's track history via the Signal K History API.

>**Note:** Your Signal K server needs to have a History API provider plugin installed and enabled.

Chart metadata is made available to client apps via both Signal K v1 and v2 resources paths.

| Server Version | API | Path |
|--- |--- |--- |
| 1.x.x | v1 | `/signalk/v1/api/resources/charts` |
| 2.x.x | v2 | `/signalk/v2/api/resources/charts` |

>_Note: [Freeboard-SK](https://www.npmjs.com/package/@signalk/freeboard-sk) v2 or later supports the use of PMTiles charts._

---

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
		"url": "/signalk/pmtiles/kvarken.pmtiles",
		"layers": []
	}
}
```

_Example: `/signalk/v1/api/resources/charts`_
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
		"tilemapUrl": "/signalk/pmtiles/kvarken.pmtiles",
		"chartLayers": []
	}
}
```

To serve the map tiles to the client, the plugin establishes the http endpoint `/signalk/pmtiles` which is used as the base path of the _url / tilemapUrl_ in the chart metadata.

Visiting this url will display a list of discovered PMTiles files _(.pmtiles)_ in the location provided in the `Plugin Config` screen.

_Example:_
```
["kvarken.pmtiles","NBottenv.pmtiles"]
```

### Charts containing track history

>**Note:** Requires SignalK server version 2.19.0 or later and a History API provider pligin installed _(e.g. `signalk-to-influxdb2`)_

You can check if your signalk server supports the History API by submitting a request to:

```typescript
HTTP GET /plugins/pmtiles-chart-provider/check-history-api
```
Example response:
```json
{"available": true}
```

#### Generate Track Chart

To generate vector charts containing your vessel's track history, submit a POST request to:

```typescript
HTTP POST /plugins/pmtiles-chart-provider/generate-track {
	"startDate": '2025-03-30T03:45:000Z",
	"endDate": '2025-03-31T09:30:000Z", 
	"resolution": "hour" 
}
```

>Valid Resolution values are: 'hour', 'day', 'week', 'month' and 'year'


Example response:
```json
{
	"success": true,
	"message": "Track chart generated successfully",
	"filename": "track_{startDate}_to_{endDate}.geojson",
	"features": 567,
	"startDate": "2025-03-30T03:45:000Z",
	"endDate": "2025-03-31T09:30:000Z", 
	"resolution": "hour" 
}
```

---
### Usage

1. Install `signalk-pmtiles-plugin` from the **Appstore** screen in the Signal K server admin console

1. Once installed, restart the server and the locate **PMTiles Chart provider** in the _Plugin Config_ screen

1. Enter the path to the folder in which you will store .pmtiles files in **Path to chart files**. 
_Note: If omitted the path will default to `.signalk/charts/pmtiles`_

1. Click **Submit** to save the changes.

1. Place your chart files _(.pmtiles)_ into folder entered in the previous step

1. **Enable** plugin

_Note: When new files are placed in the configured folders they only become available after the plugin has been restarted (disabling and enabling the plugin)._

---
