# wavesurfer.js Annotations Tool

Click on a region to enter an annotation.  
Shift-click plays a region in a loop.

## Annotation fields

- `Start`
- `End`
- `Note`

## Region events (wavesurfer instance)

- `region-in` – When playback enters a region. Callback receives the `Region` object.
- `region-out` – When playback leaves a region. Callback receives the `Region` object.
- `region-mouseenter` – When the mouse moves over a region. Callback receives the `Region` object and a `MouseEvent`.
- `region-mouseleave` – When the mouse leaves a region. Callback receives the `Region` object and a `MouseEvent`.
- `region-click` – When the mouse clicks on a region. Callback receives the `Region` object and a `MouseEvent`.
- `region-dblclick` – When the mouse double-clicks on a region. Callback receives the `Region` object and a `MouseEvent`.
- `region-created` – When a region is created. Callback receives the `Region` object.
- `region-updated` – When a region is updated. Callback receives the `Region` object.
- `region-update-end` – When dragging or resizing is finished. Callback receives the `Region` object.
- `region-removed` – When a region is removed. Callback receives the `Region` object.

## Regions plugin

Regions are visual overlays on the waveform that can be used to play and loop portions of audio. Regions can be dragged and resized.

Visual customization is possible via CSS (using the selectors `.wavesurfer-region` and `.wavesurfer-handle`).

To enable the plugin, add the script `plugin/wavesurfer.regions.js` to your page.

After doing that, use `wavesurfer.addRegion()` to create `Region` objects.

### Exposed methods

- `addRegion(options)` – Creates a region on the waveform. Returns a `Region` object. See Region Options, Region Methods and Region Events below.  
  **Note:** You cannot add regions until the audio has finished loading, otherwise the `start` and `end` properties of the new region will be set to `0`, or an unexpected value.
- `clearRegions()` – Removes all regions.
- `enableDragSelection(options)` – Lets you create regions by selecting areas of the waveform with the mouse. `options` are `Region` object params (see below).
- `disableDragSelection()` – Disables ability to create regions.

### Region options

| option  | type    | default                | description                       |
|-------- |---------|------------------------|-----------------------------------|
| `id`    | string  | random                 | The id of the region.            |
| `start` | float   | `0`                    | The start position (in seconds). |
| `end`   | float   | `0`                    | The end position (in seconds).   |
| `loop`  | boolean | `false`                | Whether to loop the region.      |
| `drag`  | boolean | `true`                 | Allow/disallow dragging.         |
| `resize`| boolean | `true`                 | Allow/disallow resizing.         |
| `color` | string  | `"rgba(0, 0, 0, 0.1)"` | HTML color code.                 |

### Region methods

- `remove()` – Remove the region object.
- `update(options)` – Modify the settings of the region.
- `play()` – Play the audio region from the start to end position.

### Region events (Region instance)

**General events**

- `in` – When playback enters the region.
- `out` – When playback leaves the region.
- `remove` – Happens just before the region is removed.
- `update` – When the region's options are updated.

**Mouse events**

- `click` – When the mouse clicks on the region. Callback receives a `MouseEvent`.
- `dblclick` – When the mouse double-clicks on the region. Callback receives a `MouseEvent`.
- `over` – When the mouse moves over the region. Callback receives a `MouseEvent`.
- `leave` – When the mouse leaves the region. Callback receives a `MouseEvent`.
