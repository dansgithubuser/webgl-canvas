import argparse
import webbrowser

parser = argparse.ArgumentParser()
parser.add_argument('--test-render', '--tr', action='store_true')
parser.add_argument('--test-browser', '--tb', action='store_true')
args = parser.parse_args()

if args.test_render:
    with open('webgl-canvas.js') as f: webgl_canvas = f.read()
    with open('test.template.html') as f: contents = f.read()
    with open('test.html', 'w') as f: f.write(contents.replace('{}', webgl_canvas))

if args.test_browser:
    webbrowser.open('test.html')
