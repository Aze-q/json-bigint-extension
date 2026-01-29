import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import babel from '@rollup/plugin-babel';
export default {
  input: 'index.js',
  output: {
    file: 'dist/index.js',
    format: 'cjs',
    exports: 'auto',
    compact: true,
  },
  // 排除第三方依赖，打包内部 lib
  external: [/node_modules/],
  plugins: [
    resolve({
      preferBuiltins: true,
      extensions: ['.js', '.json'],
    }),
    commonjs(),
    babel({
      babelHelpers: 'bundled',
      presets: ['@babel/preset-env'], // 它会把 ?. 完美转成混淆器认识的代码
    }),
  ],
};
