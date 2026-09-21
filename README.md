# RAY//MAZE

A self-contained portrait-powered maze game built with plain HTML, CSS and JavaScript. No framework, build step, backend, package install or API key is required.

## Run it

Open `index.html` directly, or serve the folder locally:

```bash
python3 -m http.server 8080
```

Then visit `http://localhost:8080`.

## Put it on GitHub Pages

1. Create a repository and copy this folder into it.
2. Push to the default branch.
3. In the repository, open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select the default branch and `/ (root)`, then save.

## Controls

- Desktop: arrow keys or WASD
- Mobile: swipe on the maze or use the direction pad
- Pause: P or Escape
- Start/restart: Enter or the on-screen button

High score is stored locally in the browser. Sound is generated in the browser, so there are no audio files to host.

## Assets

`assets/ray-sprites.png` is the production 4×2 atlas. It contains closed/open mouth states for right, left, up and down. Matching individual PNG files are included for reuse. `reference-portrait.jpeg` and the original generated atlas are retained as source material.
