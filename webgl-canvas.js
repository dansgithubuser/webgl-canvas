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
    gl_FragColor = vec4(vColor.r, vColor.g, vColor.b, 1.0);
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

export class WebGLContext {
  constructor(canvas, mode = 'immediate') {
    this.mode = mode;
    this.aColorStroke = [0, 0, 0, 255];
    this.aColorFill = [0, 0, 0, 255];
    this.clear();
    this.depth = 0.0;
    // shader program
    const gl = this.context = canvas.getContext('webgl');
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
      for (const i of ['Stroke', 'Fill'])
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
  }

  // analogs
  set strokeStyle(style) {
    this.aColorStroke = styleToColor(style);
  }

  set fillStyle(style) {
    this.aColorFill = styleToColor(style);
  }

  beginPath() {
    this.path = {
      aPosition: [],
      aColorStroke: [],
      aColorFill: [],
      aDepth: [],
    };
  }

  moveTo(x, y) {
    this.path.aPosition.push(x, y);
    this.path.aColorStroke.push(...this.aColorStroke);
    this.path.aColorFill.push(...this.aColorFill);
    this.path.aDepth.push(this.depth++);
  }

  lineTo(x, y) {
    this.moveTo(x, y);
  }

  stroke() {
    if (this.mode == 'retained') {
      // convert from LINE_STRIP to LINES so we can keep it all in one buffer
      for (var i = 0; i < this.path.aPosition.length / 2 - 1; ++i) {
        this.pathStroke.aPosition.push(...this.path.aPosition.slice((i + 0) * 2, (i + 1) * 2));
        this.pathStroke.aColor.push(...this.path.aColorStroke.slice((i + 0) * 4, (i + 1) * 4));
        this.pathStroke.aDepth.push(...this.path.aDepth      .slice((i + 0) * 1, (i + 1) * 1));
        this.pathStroke.aPosition.push(...this.path.aPosition.slice((i + 1) * 2, (i + 2) * 2));
        this.pathStroke.aColor.push(...this.path.aColorStroke.slice((i + 1) * 4, (i + 2) * 4));
        this.pathStroke.aDepth.push(...this.path.aDepth      .slice((i + 1) * 1, (i + 2) * 1));
      }
      return;
    }
    const gl = this.context;
    this.useBuffer('aPosition', 'Stroke', 2, this.path.aPosition);
    this.useBuffer('aColor', 'Stroke', 4, this.path.aColorStroke);
    this.useBuffer('aDepth', 'Stroke', 1, this.path.aDepth);
    gl.drawArrays(gl.LINE_STRIP, 0, this.path.aPosition.length / 2);
    this.depth = 0.0;
  }

  fill() {
    if (this.mode == 'retained') {
      // convert from TRIANGLE_FAN to TRIANGLES so we can keep it all in one buffer
      const base = {
        aPosition: this.path.aPosition.slice(0, 2),
        aColor: this.path.aColorFill  .slice(0, 4),
        aDepth: this.path.aDepth      .slice(0, 1),
      };
      for (var i = 1; i < this.path.aPosition.length / 2 - 1; ++i) {
        this.pathFill.aPosition.push(...base.aPosition);
        this.pathFill.aColor.push(...base.aColor);
        this.pathFill.aDepth.push(...base.aDepth);
        this.pathFill.aPosition.push(...this.path.aPosition.slice((i + 0) * 2, (i + 1) * 2));
        this.pathFill.aColor.push(...this.path.aColorFill  .slice((i + 0) * 4, (i + 1) * 4));
        this.pathFill.aDepth.push(...this.path.aDepth      .slice((i + 0) * 1, (i + 1) * 1));
        this.pathFill.aPosition.push(...this.path.aPosition.slice((i + 1) * 2, (i + 2) * 2));
        this.pathFill.aColor.push(...this.path.aColorFill  .slice((i + 1) * 4, (i + 2) * 4));
        this.pathFill.aDepth.push(...this.path.aDepth      .slice((i + 1) * 1, (i + 2) * 1));
      }
      return;
    }
    const gl = this.context;
    this.useBuffer('aPosition', 'Fill', 2, this.path.aPosition);
    this.useBuffer('aColor', 'Fill', 4, this.path.aColorFill);
    this.useBuffer('aDepth', 'Fill', 1, this.path.aDepth);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, this.path.aPosition.length / 2);
    this.depth = 0.0;
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
    this.beginPath();
    for (let i = 0; i <= n; ++i) {
      const theta = thetaI + (thetaF - thetaI) * i / n;
      const px = x + r * Math.cos(theta);
      const py = y + r * Math.sin(theta);
      this.lineTo(px, py);
    }
    this.stroke();
  }

  // new functionality
  clear() {
    if (this.mode == 'immediate') return;
    this.pathStroke = {
      aPosition: [],
      aColor: [],
      aDepth: [],
    };
    this.pathFill = {
      aPosition: [],
      aColor: [],
      aDepth: [],
    };
    this.depth = 0.0;
  }

  display({ x, y, zoom, skipGeometry }) {
    if (this.mode == 'immediate') return;
    const gl = this.context;
    gl.uniform3f(this.locations.uOrigin, x, y, zoom);
    this.useBuffer('aPosition', 'Fill'  , 2, !skipGeometry && this.pathFill.aPosition);
    this.useBuffer('aColor'   , 'Fill'  , 4, !skipGeometry && this.pathFill.aColor);
    this.useBuffer('aDepth'   , 'Fill'  , 1, !skipGeometry && this.pathFill.aDepth);
    gl.drawArrays(gl.TRIANGLES, 0, this.pathFill.aPosition.length / 2);
    this.useBuffer('aPosition', 'Stroke', 2, !skipGeometry && this.pathStroke.aPosition);
    this.useBuffer('aColor'   , 'Stroke', 4, !skipGeometry && this.pathStroke.aColor);
    this.useBuffer('aDepth'   , 'Stroke', 1, !skipGeometry && this.pathStroke.aDepth);
    gl.drawArrays(gl.LINES, 0, this.pathStroke.aPosition.length / 2);
    gl.clear(gl.DEPTH_BUFFER_BIT);
  }

  // private
  useBuffer(attrib, strokeOrFill, components, data) {
    const gl = this.context;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[attrib + strokeOrFill]);
    gl.vertexAttribPointer(this.locations[attrib], components, gl.FLOAT, false, 0, 0);
    if (data)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
  }
}
