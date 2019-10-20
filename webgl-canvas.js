const vertShaderSource = `
  attribute vec2 aPosition;
  attribute vec4 aColor;
  attribute float aDepth;

  uniform vec2 uSize;

  varying highp vec4 vColor;

  void main() {
    gl_Position = vec4(
      -1.0 + 2.0 * aPosition.x / uSize.x,
      +1.0 - 2.0 * aPosition.y / uSize.y,
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
    };
    // attributes setup
    this.buffers = {};
    const attribSetup = (attrib, components) => {
      gl.enableVertexAttribArray(this.locations[attrib]);
      this.buffers[attrib] = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[attrib]);
      gl.vertexAttribPointer(this.locations[attrib], components, gl.FLOAT, false, 0, 0);
    }
    attribSetup('aPosition', 2);
    attribSetup('aColor', 4);
    attribSetup('aDepth', 1);
    // uniforms setup
    gl.uniform2f(this.locations.uSize, canvas.width, canvas.height);
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
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.aPosition);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.path.aPosition), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.aColor);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.path.aColorStroke), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.aDepth);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.path.aDepth), gl.DYNAMIC_DRAW);
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
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.aPosition);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.path.aPosition), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.aColor);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.path.aColorFill), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.aDepth);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.path.aDepth), gl.DYNAMIC_DRAW);
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

  display() {
    if (this.mode == 'immediate') return;
    const gl = this.context;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.aPosition);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.pathFill.aPosition), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.aColor);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.pathFill.aColor), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.aDepth);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.pathFill.aDepth), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, this.pathFill.aPosition.length / 2);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.aPosition);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.pathStroke.aPosition), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.aColor);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.pathStroke.aColor), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.aDepth);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.pathStroke.aDepth), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.LINES, 0, this.pathStroke.aPosition.length / 2);
    gl.clear(gl.DEPTH_BUFFER_BIT);
  }
}
