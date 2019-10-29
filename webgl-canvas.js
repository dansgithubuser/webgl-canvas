const vertShaderSource = `
  attribute vec2 aPosition;
  attribute vec4 aColor;
  attribute float aDepth;

  uniform vec2 uSize;
  uniform vec3 uOrigin;

  varying highp vec4 vColor;

  void main() {
    gl_Position = vec4(
      (-1.0 + 2.0 * (aPosition.x - uOrigin.x) / uSize.x) * uOrigin.z,
      (+1.0 - 2.0 * (aPosition.y + uOrigin.y) / uSize.y) * uOrigin.z,
      -aDepth / 1e8,
      1.0
    );
    vColor = aColor;
  }
`;

const fragShaderSource = `
  varying highp vec4 vColor;

  void main() {
    gl_FragColor = vColor;
  }
`;

function loadShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error('Error compiling shader: ' + log);
  }
  return shader;
}

var styleToColorCache = {};
function styleToColor(style) {
  if (styleToColorCache[style]) return styleToColorCache[style];
  const canvas = document.createElement('canvas');
  canvas.height = canvas.width = 1;
  const context = canvas.getContext('2d');
  context.fillStyle = style;
  context.fillRect(0, 0, 1, 1);
  const result = Array(...context.getImageData(0, 0, 1, 1).data).map(i => i / 255.0);
  styleToColorCache[style] = result;
  return result;
}

function checkFillOrStroke(fillOrStroke) {
  if (!['Fill', 'Stroke'].includes(fillOrStroke))
    throw new Error('fillOrStroke must be "Fill" or "Stroke"');
}

class Path {
  constructor() {
    this.aPosition = [];
    this.aColor = [];
    this.aDepth = [];
    this.iStart = 0;
    this.iStartShape = 0;
  }

  push() {
    if (arguments.length == 4)
      var [x, y, color, depth] = arguments;
    else if (arguments.length == 3)
      var [{ x, y }, color, depth] = arguments;
    else if (arguments.length == 1)
      var { x, y, color, depth } = arguments[0];
    else throw new Error('invalid arguments');
    this.aPosition.push(x, y);
    this.aColor.push(...color);
    this.aDepth.push(depth);
  }

  keep() {
    this.iStart = this.fullLength;
  }

  reset() {
    if (this.fullLength == this.iStart) return;
    this.aPosition.splice(2 * this.iStart, this.aPosition.length);
    this.aColor   .splice(4 * this.iStart, this.aColor.length);
    this.aDepth   .splice(1 * this.iStart, this.aDepth.length);
  }

  getShape() {
    this.reset();
    const range = {
      start: this.iStartShape,
      end: this.fullLength,
      length: this.fullLength - this.iStartShape,
    };
    this.iStartShape = this.fullLength;
    return { path: this, range };
  }

  get fullLength() {
    return this.aDepth.length;
  }

  get length() {
    return this.fullLength - this.iStart;
  }

  get start() {
    return {
      x: this.aPosition[this.iStart * 2 + 0],
      y: this.aPosition[this.iStart * 2 + 1],
      color: this.aColor.slice(this.iStart * 4, (this.iStart + 1) * 4),
      depth: this.aDepth[this.iStart],
    };
  }
}

class Shape {
  constructor(fill, stroke, buffers, gl) {
    this.fill = fill;
    this.stroke = stroke;
    this.buffers = buffers;
    this.gl = gl;
  }

  move(dx, dy, fillOrStroke) {
    if (fillOrStroke === undefined) {
      this.move(dx, dy, 'Fill');
      this.move(dx, dy, 'Stroke');
      return;
    }
    this.transform(([x, y]) => [x + dx, y - dy], fillOrStroke, 'aPosition', 2);
  }

  recolor(r, g, b, a, fillOrStroke) {
    this.transform(() => [r, g, b, a], fillOrStroke, 'aColor', 4);
  }

  hide() {
    this.recolor(0, 0, 0, 0, 'Fill');
    this.recolor(0, 0, 0, 0, 'Stroke');
  }

  geometrize() {
    for (const fillOrStroke of ['Fill', 'Stroke'])
      for (const [attrib, stride] of [['aPosition', 2], ['aColor', 4], ['aDepth', 1]])
        this.transform(null, fillOrStroke, attrib, stride);
  }

  // private
  transform(f, fillOrStroke, attrib, stride) {
    checkFillOrStroke(fillOrStroke);
    const gl = this.gl;
    const path = this[fillOrStroke.toLowerCase()].path;
    const range = this[fillOrStroke.toLowerCase()].range;
    if (f) this.apply(path[attrib], range, stride, f);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[attrib + fillOrStroke]);
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      range.start * stride * 4,
      new Float32Array(path[attrib]),
      range.start * stride,
      range.length * stride,
    );
  }

  apply(array, range, stride, f) {
    for (let i = range.start * stride; i < range.end * stride; i += stride) {
      const y = f(array.slice(i, i + stride));
      for (let j = 0; j < stride; ++j)
        array[i + j] = y[j];
    }
  }
}

export class WebGLContext {
  constructor(canvas, mode = 'immediate') {
    this.mode = mode;
    this.aPosition = {};
    this.aColorFill = [0, 0, 0, 255];
    this.aColorStroke = [0, 0, 0, 255];
    this.pathReset();
    // shader program
    const gl = this.context = canvas.getContext('webgl2');
    const vertShader = loadShader(gl, gl.VERTEX_SHADER  , vertShaderSource);
    const fragShader = loadShader(gl, gl.FRAGMENT_SHADER, fragShaderSource);
    this.program = gl.createProgram();
    gl.attachShader(this.program, vertShader);
    gl.attachShader(this.program, fragShader);
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS))
      throw new Error('Error linking program: ' + gl.getProgramInfoLog(this.program));
    gl.useProgram(this.program);
    this.locations = {
      aPosition: gl.getAttribLocation(this.program, 'aPosition'),
      aColor: gl.getAttribLocation(this.program, 'aColor'),
      aDepth: gl.getAttribLocation(this.program, 'aDepth'),
      uSize: gl.getUniformLocation(this.program, 'uSize'),
      uOrigin: gl.getUniformLocation(this.program, 'uOrigin'),
    };
    // attributes setup
    this.buffers = {};
    const attribSetup = (attrib) => {
      gl.enableVertexAttribArray(this.locations[attrib]);
      for (const i of ['Fill', 'Stroke'])
        this.buffers[attrib + i] = gl.createBuffer();
    }
    attribSetup('aPosition');
    attribSetup('aColor');
    attribSetup('aDepth');
    // uniforms setup
    gl.uniform2f(this.locations.uSize, canvas.width, canvas.height);
    gl.uniform3f(this.locations.uOrigin, 0, 0, 1);
    // depth
    gl.clearDepth(1.0);
    gl.depthFunc(gl.LEQUAL);
    if (this.mode == 'retained')
      gl.enable(gl.DEPTH_TEST);
    // alpha
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  // analogs
  set fillStyle(style) {
    this.aColorFill = styleToColor(style);
  }

  set strokeStyle(style) {
    this.aColorStroke = styleToColor(style);
  }

  beginPath() {
    if (this.mode == 'immediate') {
      this.pathReset();
    } else if (this.mode == 'retained') {
      this.pathFill.reset();
      this.pathStroke.reset();
    }
  }

  moveTo(x, y) {
    this.aPosition.x = x;
    this.aPosition.y = y;
  }

  lineTo(x, y) {
    // fill
    if (this.pathFill.length >= 3)
      this.pathFill.push(this.pathFill.start);
    if (this.pathFill.length != 2)
      this.pathFill.push(this.aPosition, this.aColorFill, this.aDepth);
    this.pathFill.push(x, y, this.aColorFill, this.aDepth++);
    // stroke
    this.pathStroke.push(this.aPosition, this.aColorStroke, this.aDepth);
    this.pathStroke.push(x, y, this.aColorStroke, this.aDepth++);
    // move
    this.aPosition.x = x;
    this.aPosition.y = y;
  }

  fill() {
    if (this.mode == 'immediate') {
      const gl = this.context;
      this.useBuffer('aPosition', 'Fill', 2, this.pathFill.aPosition);
      this.useBuffer('aColor', 'Fill', 4, this.pathFill.aColor);
      this.useBuffer('aDepth', 'Fill', 1, this.pathFill.aDepth);
      gl.drawArrays(gl.TRIANGLES, 0, this.pathFill.fullLength);
    } else if (this.mode == 'retained') {
      this.pathFill.keep();
    }
  }

  stroke() {
    if (this.mode == 'immediate') {
      const gl = this.context;
      this.useBuffer('aPosition', 'Stroke', 2, this.pathStroke.aPosition);
      this.useBuffer('aColor', 'Stroke', 4, this.pathStroke.aColor);
      this.useBuffer('aDepth', 'Stroke', 1, this.pathStroke.aDepth);
      gl.drawArrays(gl.LINES, 0, this.pathStroke.fullLength);
    } else if (this.mode == 'retained') {
      this.pathStroke.keep();
    }
  }

  fillRect(x, y, w, h) {
    this.beginPath();
    this.moveTo(x    , y    );
    this.lineTo(x + w, y    );
    this.lineTo(x + w, y + h);
    this.lineTo(x    , y + h);
    this.lineTo(x    , y    );
    this.fill();
  }

  arc(x, y, r, thetaI, thetaF, n = 17) {
    for (let i = 0; i <= n; ++i) {
      const theta = thetaI + (thetaF - thetaI) * i / n;
      const px = x + r * Math.cos(theta);
      const py = y + r * Math.sin(theta);
      if (i == 0)
        this.moveTo(px, py);
      else
        this.lineTo(px, py);
    }
  }

  // new functionality
  clear() {
    if (this.mode != 'retained') return;
    this.pathReset();
  }

  display({ x, y, zoom, skipGeometry }) {
    if (this.mode != 'retained') return;
    const gl = this.context;
    gl.uniform3f(this.locations.uOrigin, x, y, zoom);
    this.useBuffer('aPosition', 'Fill'  , 2, !skipGeometry && this.pathFill.aPosition);
    this.useBuffer('aColor'   , 'Fill'  , 4, !skipGeometry && this.pathFill.aColor);
    this.useBuffer('aDepth'   , 'Fill'  , 1, !skipGeometry && this.pathFill.aDepth);
    gl.drawArrays(gl.TRIANGLES, 0, this.pathFill.fullLength);
    this.useBuffer('aPosition', 'Stroke', 2, !skipGeometry && this.pathStroke.aPosition);
    this.useBuffer('aColor'   , 'Stroke', 4, !skipGeometry && this.pathStroke.aColor);
    this.useBuffer('aDepth'   , 'Stroke', 1, !skipGeometry && this.pathStroke.aDepth);
    gl.drawArrays(gl.LINES, 0, this.pathStroke.fullLength);
    gl.clear(gl.DEPTH_BUFFER_BIT);
  }

  getShape() {
    return new Shape(
      this.pathFill.getShape(),
      this.pathStroke.getShape(),
      this.buffers,
      this.context,
    );
  }

  // private
  useBuffer(attrib, fillOrStroke, components, data) {
    checkFillOrStroke(fillOrStroke);
    const gl = this.context;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[attrib + fillOrStroke]);
    gl.vertexAttribPointer(this.locations[attrib], components, gl.FLOAT, false, 0, 0);
    if (data) {
      gl.bufferData(gl.ARRAY_BUFFER, 2 * data.length * 4, gl.DYNAMIC_DRAW);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(data), 0, data.length);
    }
  }

  pathReset() {
    this.aDepth = 0.0;
    this.pathFill = new Path();
    this.pathStroke = new Path();
  }
}
