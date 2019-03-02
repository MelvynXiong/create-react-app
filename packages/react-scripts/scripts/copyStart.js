'use strict';

// 配置环境变量
process.env.BABEL_ENV = 'development';
process.env.NODE_ENV = 'development';

// 当promise被reject后， 但是没有相关的error处理函数时抛出
process.on('unhandledRejection', err => {
  throw err;
});

// Ensure environment variables are read.
require('../config/env');
