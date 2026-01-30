import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import babel from '@rollup/plugin-babel';
import path from 'path'; 

export default {
  input: 'index.js',
  output: {
    file: 'dist/index.js',
    format: 'cjs',
    exports: 'auto',
    compact: true,
  },
  // 核心修复：确保不排除入口文件本身
  external: (id) => {
    // 1. 入口文件绝对不能是 external
    if (id.includes('index.js')) return false;

    // 2. 排除 node_modules
    if (/node_modules/.test(id)) return true;

    // 3. 排除以 @ 开头的业务别名路径（这是解决你报错的关键）
    if (id.startsWith('@')) return true;

    // 4. 使用 path 判断：如果不是相对路径且不是绝对路径，则视为外部依赖
    // 这样可以确保它不会去尝试打包主程序的业务逻辑
    return !id.startsWith('.') && !path.isAbsolute(id);
  },
  plugins: [
    resolve({
      preferBuiltins: true,
      extensions: ['.js', '.json'],
    }),
    commonjs({
      ignoreDynamicRequires: true,
      transformMixedEsModules: true,
    }),
    babel({
      babelHelpers: 'bundled',
      presets: ['@babel/preset-env'], 
    }),
  ],
};