# WebGL Canvas
WebGL Canvas eases the transition from a 2D context to a WebGL context when using HTML5 canvas. It can be dropped-in, and then new functionality can be taken advantage of. Only a subset of functionality will be preserved, decided by what it is being used for.

## Dropping In
Replace occurrences of `canvas.getContext('2d')` with `new WebGLContext(canvas)`.

## New Functionality
The main benefit comes from decoupling geometry from rendering. By default, a `WebGLContext`'s `mode` is `'immediate'`, which makes it act like a 2D context. TODO

## What's Supported
See which methods are defined in the `WebGLContext` class.

### Exceptions
Not all functionality implied above is implemented.

- The analogy is not guaranteed to be pixel-perfect.
- `fill` only works on paths that can be traced from the first point without intersection.
