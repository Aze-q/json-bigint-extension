const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

const obfuscationConfig = {
  compact: true,
  target: 'node',
  identifierNamesGenerator: 'hexadecimal',

  // 逻辑扁平化
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 1,

  // 字符串加密
  stringArray: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayThreshold: 1,
  // --- 关键修复：根据报错信息，这里必须是字符串 ---
  stringArrayEncoding: 'rc4', 
  stringArrayCallsTransform: true,

  // 视觉粉碎
  unicodeEscapeSequence: true,
  splitStrings: true,
  // 保持为 5，防止路径字符串被切得太碎导致 Node 无法解析
  splitStringsChunkLength: 5, 

  // --- 增强修复：保护业务路径别名不被加密/切碎 ---
  reservedStrings: [
    'express', 'path', 'fs', 'vm', 
    '^@',           // 匹配所有以 @ 开头的路径
    '^@services',    // 专门保护你的业务服务路径
    '^\./',         // 保护相对路径
    '\.js$', '\.json$' // 保护文件后缀
  ],
  
  // 保护 Node.js 核心全局变量名
  reservedNames: [
    'module', 'exports', 'require', 'process', 
    '__dirname', '__filename', 'global', 'Error'
  ],

  // 注入死代码
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.2,

  // 防篡改
  selfDefending: true, 
  transformObjectKeys: false, // 必须为 false，否则会破坏 require 的属性访问
  sourceMap: false,
};

const targetFile = path.join(__dirname, 'dist/index.js');

if (fs.existsSync(targetFile)) {
  console.log('🚀 开始对单体文件进行地狱级混淆...');
  const code = fs.readFileSync(targetFile, 'utf8');

  try {
    const result = JavaScriptObfuscator.obfuscate(code, obfuscationConfig);
    const obfuscatedCode = result.getObfuscatedCode();
    
    fs.writeFileSync(targetFile, obfuscatedCode);
    console.log('✅ 单体文件混淆成功！最终产物：dist/index.js');
    
    // 自检逻辑
    if (!obfuscatedCode.includes('require')) {
        console.warn('⚠️ 警告：混淆产物中丢失了 "require" 关键字，可能会导致外部加载失败。');
    }
    
  } catch (err) {
    console.error('❌ 混淆过程出错:', err.message);
  }
} else {
  console.error('❌ 未找到构建后的 index.js，请先运行 rollup -c');
}