import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import path from 'path';

export default {
  // 单一入口文件
  input: 'index.js', 
  output: {
    // 输出为单个单体文件
    file: 'dist/index.js', 
    format: 'cjs',
    exports: 'auto',
    compact: true, 
  },
  // 仅排除真正的 node_modules 依赖，不排除项目内部的 lib 路径
  external: [/node_modules/], 
  plugins: [
    resolve({ 
        preferBuiltins: true,
        // 确保能正确识别项目内的文件
        extensions: ['.js', '.json'] 
    }),
    commonjs()
  ]
};