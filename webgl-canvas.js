const vertShaderSource = `
  attribute vec2 aPosition;
  attribute vec4 aColor;

  uniform vec2 uSize;

  varying highp vec4 vColor;

  void main() {
    gl_Position = vec4(
      -1.0 + 2.0 * aPosition.x / uSize.x,
      +1.0 - 2.0 * aPosition.y / uSize.y,
      0.0,
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
  constructor(canvas) {
    // new functionality members
    this.mode = 'immediate';
    // ----- internal ----- //
    this.aColorStroke = [0, 0, 0, 255];
    this.aColorFill = [0, 0, 0, 255];
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
    // uniforms setup
    gl.uniform2f(this.locations.uSize, canvas.width, canvas.height);
  }

  // analogy methods
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
    };
  }

  moveTo(x, y) {
    this.path.aPosition.push(x, y);
    this.path.aColorStroke.push(...this.aColorStroke);
    this.path.aColorFill.push(...this.aColorFill);
  }

  lineTo(x, y) {
    this.moveTo(x, y);
  }

  stroke() {
    const gl = this.context;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.aPosition);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.path.aPosition), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.aColor);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.path.aColorStroke), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.LINE_STRIP, 0, this.path.aPosition.length / 2);
  }

  fill() {
    const gl = this.context;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.aPosition);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.path.aPosition), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.aColor);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.path.aColorFill), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, this.path.aPosition.length / 2);
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
}
