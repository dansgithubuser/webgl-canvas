import webbrowser

with open('webgl-canvas.js') as f: webgl_canvas = f.read()
with open('test.template.html') as f: contents = f.read()
with open('test.html', 'w') as f: f.write(contents.replace('{}', webgl_canvas))
webbrowser.open('test.html')
