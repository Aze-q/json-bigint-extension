const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

const obfuscationConfig = {
  compact: true,
  target: 'node',
  identifierNamesGenerator: 'hexadecimal',

  // 逻辑迷宫：100% 扁平化
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 1,

  // 字符串防御：RC4 动态加解密
  stringArray: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayThreshold: 1,
  stringArrayEncoding: 'rc4',
  stringArrayCallsTransform: true,

  // 视觉粉碎
  unicodeEscapeSequence: true,
  splitStrings: true,
  splitStringsChunkLength: 3,

  // 单体模式下，内部别名已经被 Rollup 替换为局部引用，
  // 这里的白名单只需要保留对外部 node_modules 的 require 保护
  reservedStrings: ['express', 'path', 'fs', 'vm'],
  reservedNames: ['module', 'exports', 'require', 'process', '__dirname'],

  // 注入死代码
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.2,

  selfDefending: true,
  transformObjectKeys: false,
  sourceMap: false,
};

const targetFile = path.join(__dirname, 'dist/index.js');

if (fs.existsSync(targetFile)) {
  console.log('🚀 开始对单体文件进行地狱级混淆...');
  const code = fs.readFileSync(targetFile, 'utf8');

  try {
    const result = JavaScriptObfuscator.obfuscate(code, obfuscationConfig);
    fs.writeFileSync(targetFile, result.getObfuscatedCode());
    console.log('✅ 单体文件混淆成功！最终产物：dist/index.js');
  } catch (err) {
    console.error('❌ 混淆过程出错:', err.message);
  }
} else {
  console.error('❌ 未找到构建后的 index.js，请先运行 rollup -c');
}
