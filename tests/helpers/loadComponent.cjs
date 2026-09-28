const path = require('node:path');
const Module = require('node:module');
const babel = require('@babel/core');

module.exports = function loadComponent(file, mocks) {
    const filename = path.resolve(file);
    const output = babel.transformFileSync(filename, {
        babelrc: false, configFile: false,
        presets: [['@babel/preset-react', { runtime: 'automatic' }]],
        plugins: ['@babel/plugin-transform-modules-commonjs'],
    });
    const loaded = new Module(filename, module);
    loaded.filename = filename;
    loaded.paths = Module._nodeModulePaths(path.dirname(filename));
    const originalRequire = loaded.require.bind(loaded);
    loaded.require = name => /\.(png|jpg|mp4)$/.test(name) ? 1 : Object.hasOwn(mocks, name) ? mocks[name] : originalRequire(name);
    loaded._compile(output.code, filename);
    return loaded.exports;
};
