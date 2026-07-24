# AutoDraw for skribbl.io

Chrome extension that automatically draws images in [skribbl.io](https://skribbl.io/).
Drop an image on the drawing canvas to start.

Silhouettes are converted to simplified, watertight contours and bucket fills.
Images that are not confidently detected as silhouettes use a multi-width color planner.
The control below the drawing toolbar estimates remaining time and can adjust speed, pause, resume, or cancel the current drawing.

![Drawing a Starfish](/drawing-a-starfish.gif)

## Development

```sh
npm install
npm run verify
```

Load this directory as an unpacked extension in Chrome after building.
