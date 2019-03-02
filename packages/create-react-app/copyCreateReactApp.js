'use strict'

const validateProjectName = require('validate-npm-package-name'); // 检查string是否为有效的npm包名
const chalk = require('chalk');
const commander = require('commander'); // node.js 命令行接口
const fs = require('fs-extra'); // 外部依赖，增强的文件操作模块 加了对promise的支持
const path = require('path');
const execSync = require('child_process').execSync; // 通过多进程来实现对多核CPU的利用
const spawn = require('cross-spawn');  //  用来执行node进程, node跨平台解决方案
const semver = require('semver'); // 提供api来比较node版本
const dns = require('dns');  // 原生模块 dns相关
const tmp = require('tmp');  // node 临时文件或文件夹creator
const unpack = require('tar-pack').unpack;
const url = require('url');
const hyperquest = require('hyperquest');  //  treat http requests as a streaming transport
const envinfo = require('envinfo'); // 可以打印当前操作系统的环境和指定包的信息
const os = require('os'); // 提供操作系统相关的api

const packageJson = require('./package.json');

const errorLogFilePatterns = [
    'npm-deubug.log',
    'yarn-error.log',
    'yarn-debug.log'
];

let projectName; // 定义一个用来存储项目名称的变量

// option() 增加命令参数和命令描述
const program = new commander
	.Command(packageJson.name) // 新建一个command
	.version(packageJson.version) // version() 可以通过-V 或 --version查看
	.arguments('<project-directory>') // 为顶层command定义参数 这里指 create-react-app 后面跟的文件夹名字
	.usage(`${chalk.green('<project-directory>')} [options]`) // 当查看help的时候能看见usage的提示信息
	.action(name => {
		projectName = name;
	}) // 命令结束后的回调, 参数从命令中来
	.option('--verbose', 'print additional logs')
  .option('--info', 'print environment debug info')
	.option(
    '--scripts-version <alternative-package>',
    'use a non-standard version of react-scripts'
  ) // 指定特定版本的react-scripts
  .option('--use-npm') // create-react-app 默认使用yarn安装，运行
  .option('--use-pnp') // yarn的新特性Plug'n'Play
	.option('--typescript')
	.allowUnknownOption() // 允许无效的option
	.on('--help', () => {
    console.log(`    Only ${chalk.green('<project-directory>')} is required.`);
    console.log();
    console.log(
      `    A custom ${chalk.cyan('--scripts-version')} can be one of:`
    );
    console.log(`      - a specific npm version: ${chalk.green('0.8.2')}`);
    console.log(`      - a specific npm tag: ${chalk.green('@next')}`);
    console.log(
      `      - a custom fork published on npm: ${chalk.green(
        'my-react-scripts'
      )}`
    );
    console.log(
      `      - a local path relative to the current working directory: ${chalk.green(
        'file:../my-react-scripts'
      )}`
    );
    console.log(
      `      - a .tgz archive: ${chalk.green(
        'https://mysite.com/my-react-scripts-0.8.2.tgz'
      )}`
    );
    console.log(
      `      - a .tar.gz archive: ${chalk.green(
        'https://mysite.com/my-react-scripts-0.8.2.tar.gz'
      )}`
    );
    console.log(
      `    It is not needed unless you specifically want to use a fork.`
    );
    console.log();
    console.log(
      `    If you have any problems, do not hesitate to file an issue:`
    );
    console.log(
      `      ${chalk.cyan(
        'https://github.com/facebook/create-react-app/issues/new'
      )}`
    );
    console.log();
	}) // 自定义help信息
	.parse(process.argv); // 这个就是解析我们正常的`Node`进程，可以这么理解没有这个东东，`commander`就不能接管`Node`

// 如果传入了 --info 选项执行
if (program.info) {
	console.log(chalk.bold('\nEnvironment Info:'));
	return envinfo // 有选择性的打印本机信息
		.run(
			{
				System: ['OS', 'CPU'],
				Binaries: ['Node', 'npm', 'Yarn'],
				Browsers: ['Chrome', 'Edge', 'Internet Explorer', 'Firefox', 'Safari'],
				npmPackages: ['react', 'react-dom', 'react-scripts'],
				npmGlobalPackages: ['create-react-app'],
			},
			{
				clipboard: true,
				duplicates: true,
				showNotFound: true,
			}
		)
		.then(console.log)
		.then(() => console.log(chalk.green('Copied To Clipboard!\n')));
}

// 当 create-react-app 命令后没加 <project-directory> 参数执行
if (typeof projectName === 'undefined') {
	console.error('Please specify the project directory:');
  console.log(
    `  ${chalk.cyan(program.name())} ${chalk.green('<project-directory>')}`
  );
  console.log();
  console.log('For example:');
  console.log(`  ${chalk.cyan(program.name())} ${chalk.green('my-react-app')}`);
  console.log();
  console.log(
    `Run ${chalk.cyan(`${program.name()} --help`)} to see all options.`
	);
	// 抛出异常，退出进程
  process.exit(1);
}

// 打印校验结果
function printValidationResults(results) {
	if (typeof results !== 'undefined') {
		results.forEach(error => {
      console.error(chalk.red(`  *  ${error}`));
    });
	}
}

// 内部测试，用来更改初始化目录的模板
const hiddenProgram = new commander.Command()
  .option(
    '--internal-testing-template <path-to-template>',
    '(internal usage only, DO NOT RELY ON THIS) ' +
      'use a non-standard application template'
  )
  .parse(process.argv);

// 执行createApp函数
createApp(
	projectName, // 初始化项目的名称
	program.verbose, // additional logs 例如安装时发生错误的信息
	program.scriptsVersion, // 单独配置的react-scripts版本
	program.useNpm, // 如果加了 --use-npm 该选项就为true
	program.usePnp,
	program.typescript,
	hiddenProgram.internalTestingTemplate // 如果存在，该选项为<path-to-template>
);

// 该函数在当前目录下创建了一个项目目录，
// 且校验了该目录的名称是否合法，是否安全
// 然后往其中写入package.json文件
// 并且判断了当前环境下该使用的react-scripts版本
// 最后执行run()函数
function createApp(
	name,
  verbose,
  version,
  useNpm,
  usePnp,
  useTypescript,
  template
) {
	const root = path.resolve(name); // 返回将创建的项目的绝对路径
	const appName = path.basename(root); // 返回path的最后部分

	checkAppName(appName); // 检验项目名称是否合法
	fs.ensureDirSync(name); // 在当前路径下创建文件夹，确保项目的存在
	// 判断文件目录目录是否安全
	if (!isSafeToCreateProjectIn(root, name)) {
		// 不合法结束进程
		process.exit(1);
	}

	// 打印 react项目成功创建
	console.log(`Creating a new React app in ${chalk.green(root)}.`);
	console.log();

	// 定义创建项目中package.json的具体内容
	const packageJson = {
		name: appName,
		version: '0.1.0',
		private: true
	}

	// 往创建的文件夹中写入package.json文件
	// 用了fs-extra的api
	fs.writeJsonSync(
		path.join(root, 'package.json'),
		packageJson,
		{
			spaces: 2, // 控制每行属性的缩进
			EOL: os.EOL // 行尾结束符 \n 或者 \r\n
		}
	);
	// 如果传参 --use-npm, useYarn为false
	// 执行shouldUseYarn() 检查本机是否安装了yarn
	const useYarn = useNpm ? false : shouldUseYarn();
	const originalDirectory = process.cwd(); // 当前node进程的目录

	// 修改node进程目录为创建的项目目录
	process.chdir(root);

	// chekcThatNpmCanReadCwd 检查进程目录是不是我们创建的目录，
	// 也就是说如果进程不在我们创建的目录里面，后续再执行`npm`安装的时候就会出错，所以提前检查
	if (!useYarn && !checkThatNpmCanReadCwd()) {
		process.exit(1);
	}

	// 比较node版本，当版本号小于6 打印警告
	// 并且指定react-scripts版本为0.9.x, 为了兼容性考虑
	if (!semver.satisfies(process.version, '>=6.0.0')) {
    console.log(
      chalk.yellow(
        `You are using Node ${
          process.version
        } so the project will be bootstrapped with an old unsupported version of tools.\n\n` +
          `Please update to Node 6 or higher for a better, fully supported experience.\n`
      )
    );
    // Fall back to latest supported react-scripts on Node 4
    version = 'react-scripts@0.9.x';
	}
	
	if (!useYarn) {
		// checkNpmVersion 检测本机是否安装了npm
		// 判断npm版本是否在3.0.0以上
		const npmInfo = checkNpmVersion();
		if (!npmInfo.hasMinNpm) {
      if (npmInfo.npmVersion) {
        console.log(
          chalk.yellow(
            `You are using npm ${
              npmInfo.npmVersion
            } so the project will be boostrapped with an old unsupported version of tools.\n\n` +
              `Please update to npm 3 or higher for a better, fully supported experience.\n`
          )
        );
      }
      // Fall back to latest supported react-scripts for npm 3
      version = 'react-scripts@0.9.x';
    } else if (usePnp) {
			// 使用usePnp时 判断yarn的版本，版本低于1.12不兼容
			const yarnInfo = checkYarnVersion();
			if (!yarnInfo.hasMinYarnPnp) {
				if (yarnInfo.yarnVersion) {
					chalk.yellow(
						`You are using Yarn ${
							yarnInfo.yarnVersion
						} together with the --use-pnp flag, but Plug'n'Play is only supported starting from the 1.12 release.\n\n` +
							`Please update to Yarn 1.12 or higher for a better, fully supported experience.\n`
					);
				}
				// 1.11 had an issue with webpack-dev-middleware, so better not use PnP with it (never reached stable, but still)
				usePnp = false;
			}
		}
	}
	
	// 如果使用yarn, 写入yarn的配置文件
	if (useYarn) {
		fs.copySync (
			require.resolve('./yarn.lock.cached'), // 返回该文件带有完整绝对路径的文件名
      path.join(root, 'yarn.lock') // 如果该文件不存在，则直接创建
		);
	}

	// 执行run函数
	run (
		root,  // 项目的绝对路径
		appName, // 项目名称
		version,  // react-scripts 版本号
		verbose,  // additional log
		originalDirectory,  // 项目所在的目录
		template,  // 初始化目录的模板
		useYarn,
		usePnp,
		useTypescript
	);
}

// 用外部依赖来校验文件名是否符合npm规范
// 然后定义三个不能用的名字
function checkAppName(appName) {
	// 包名是否合法的返回结果
	const validationResult = validateProjectName(appName);
	// 包名不合法，打印错误,结束进程
	if (!validationResult.validForNewPackages) {
    console.error(
      `Could not create a project called ${chalk.red(
        `"${appName}"`
      )} because of npm naming restrictions:`
    );
    printValidationResults(validationResult.errors);
    printValidationResults(validationResult.warnings);
    process.exit(1);
	}
	// 定义三个开发依赖的名称
	const dependencies = ['react', 'react-dom', 'react-scripts'].sort();
	// 如果创建的项目名称使用了默认的开发依赖名， 报错并退出进程
	if (dependencies.indexOf(appName) >= 0) {
    console.error(
      chalk.red(
        `We cannot create a project called ${chalk.green(
          appName
        )} because a dependency with the same name exists.\n` +
          `Due to the way npm works, the following names are not allowed:\n\n`
      ) +
        chalk.cyan(dependencies.map(depName => `  ${depName}`).join('\n')) +
        chalk.red('\n\nPlease choose a different project name.')
    );
    process.exit(1);
  }
}
// 检测文件夹是否安全
function isSafeToCreateProjectIn(root, name) {
	const validFiles = [
    '.DS_Store',
    'Thumbs.db',
    '.git',
    '.gitignore',
    '.idea',
    'README.md',
    'LICENSE',
    '.hg',
    '.hgignore',
    '.hgcheck',
    '.npmignore',
    'mkdocs.yml',
    'docs',
    '.travis.yml',
    '.gitlab-ci.yml',
    '.gitattributes',
	];
	console.log();

	const conflicts = fs
		.readdirSync(root) // 读取项目文件夹下的文件, 返回的是文件名组成的字符串数组
		.filter(file => !validFiles.includes(file)) // 筛选掉开发者使用的有效文件
		.filter(file => !/\.iml$/.test(file))  // 筛选掉iml后缀名的文件
		.filter(
			// 筛选掉error日志文件
      file => !errorLogFilePatterns.some(pattern => file.indexOf(pattern) === 0)
		);
	
	// 打印出不安全的文件，返回false	
	if (conflicts.length > 0) {
		console.log(
			`The directory ${chalk.green(name)} contains files that could conflict:`
		);
		console.log();
		for (const file of conflicts) {
			console.log(`  ${file}`);
		}
		console.log();
		console.log(
			'Either try using a new directory name, or remove the files listed above.'
		);

		return false;
	}	

	// 删掉以前的遗留日志文件
	const currentFiles = fs.readdirSync(path.join(root));
  currentFiles.forEach(file => {
    errorLogFilePatterns.forEach(errorLogFilePattern => {
      // This will catch `(npm-debug|yarn-error|yarn-debug).log*` files
      if (file.indexOf(errorLogFilePattern) === 0) {
        fs.removeSync(path.join(root, file));
      }
    });
  });
  return true;
}
// 检查本机是否安装了yarn
function shouldUseYarn() {
	try {
		// 执行yarnpkg --version 命令来判断是否正确安装了yarn
    execSync('yarnpkg --version', { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

// 检查进程目录是不是我们创建的项目目录，
function checkThatNpmCanReadCwd() {
	const cwd = process.cwd(); // 取到当前的进程目录
	let childOutput = null;  // 定义一个变量来保存npm的信息
	try {
		// 相当于执行`npm config list`并将其输出的信息组合成为一个字符串
		childOutput = spawn.sync('npm', ['config', 'list']).output.join('');
	} catch (err) {
		return true;
	}
	if (typeof childOutput !== 'string') {
    return true;
	}
	// 整个字符串以换行符分割
	const lines = childOutput.split('\n');
	// 定义一个需要的信息的前缀
	const prefix = '; cwd = ';
	// 查找该前缀的那行
	const line = lines.find(line => line.indexOf(prefix) === 0);
  if (typeof line !== 'string') {
    return true;
	}
	const npmCWD = line.substring(prefix.length);
  if (npmCWD === cwd) {
    return true;
	}
	// 打印错误信息
	console.error(
    chalk.red(
      `Could not start an npm process in the right directory.\n\n` +
        `The current directory is: ${chalk.bold(cwd)}\n` +
        `However, a newly started npm process runs in: ${chalk.bold(
          npmCWD
        )}\n\n` +
        `This is probably caused by a misconfigured system terminal shell.`
    )
  );
  if (process.platform === 'win32') {
    console.error(
      chalk.red(`On Windows, this can usually be fixed by running:\n\n`) +
        `  ${chalk.cyan(
          'reg'
        )} delete "HKCU\\Software\\Microsoft\\Command Processor" /v AutoRun /f\n` +
        `  ${chalk.cyan(
          'reg'
        )} delete "HKLM\\Software\\Microsoft\\Command Processor" /v AutoRun /f\n\n` +
        chalk.red(`Try to run the above two lines in the terminal.\n`) +
        chalk.red(
          `To learn more about this problem, read: https://blogs.msdn.microsoft.com/oldnewthing/20071121-00/?p=24433/`
        )
		);
		return false;
  }
}

function checkNpmVersion() {
  let hasMinNpm = false;
  let npmVersion = null;
  try {
    npmVersion = execSync('npm --version')
      .toString()
      .trim();
    hasMinNpm = semver.gte(npmVersion, '3.0.0');
  } catch (err) {
    // ignore
  }
  return {
    hasMinNpm: hasMinNpm,
    npmVersion: npmVersion,
  };
}

function checkYarnVersion() {
  let hasMinYarnPnp = false;
  let yarnVersion = null;
  try {
    yarnVersion = execSync('yarnpkg --version')
      .toString()
      .trim();
    let trimmedYarnVersion = /^(.+?)[-+].+$/.exec(yarnVersion);
    if (trimmedYarnVersion) {
      trimmedYarnVersion = trimmedYarnVersion.pop();
    }
    hasMinYarnPnp = semver.gte(trimmedYarnVersion || yarnVersion, '1.12.0');
  } catch (err) {
    // ignore
  }
  return {
    hasMinYarnPnp: hasMinYarnPnp,
    yarnVersion: yarnVersion,
  };
}

function run() {
	root,
  appName,
  version,
  verbose,
  originalDirectory,
  template,
  useYarn,
  usePnp,
  useTypescript
} {
	// 获取要安装的react-scripts版本或者开发者自己定义的react-scripts
	const packageToInstall = getInstallPackage(version, originalDirectory);
	const allDependencies = ['react', 'react-dom', packageToInstall]; // 所有的开发依赖包
	// 如果使用Typescript， 增加依赖包
	if (useTypescript) {
    allDependencies.push(
      '@types/node',
      '@types/react',
      '@types/react-dom',
      '@types/jest',
      'typescript'
    );
	}
	console.log('Installing packages. This might take a couple of minutes.');
	getPackageName(packageToInstall)
		.then(packageName =>
			// 检查是否离线模式，并返回结果和包名
      checkIfOnline(useYarn).then(isOnline => ({
        isOnline: isOnline,
        packageName: packageName,
      }))
		)
		.then(info => {
			const isOnline = info.isOnline;
      const packageName = info.packageName;
      console.log(
        `Installing ${chalk.cyan('react')}, ${chalk.cyan(
          'react-dom'
        )}, and ${chalk.cyan(packageName)}...`
      );
			console.log();
			
			return install(
				root,
				useYarn,
				allDependencies,
				verbose,
				isOnline
			).then(() => packageName);
		})
		.then(async packageName => {
			// 检查当前node版本是否支持包
			checkNodeVersion(packageName);
			// 检查package.json的开发依赖是否正常
			setCaretRangeForRuntimeDeps(packageName);
			
			const pnpPath = path.resolve(process.cwd(), '.pnp.js');

			const nodeArgs = fs.existsSync(pnpPath) ? ['--require', pnpPath] : [];
			
			await executeNodeScript(
        {
          cwd: process.cwd(),
          args: nodeArgs,
        },
        [root, appName, verbose, originalDirectory, template],
        `
        var init = require('${packageName}/scripts/init.js');
        init.apply(null, JSON.parse(process.argv[1]));
      `
      );

      if (version === 'react-scripts@0.9.x') {
        console.log(
          chalk.yellow(
            `\nNote: the project was bootstrapped with an old unsupported version of tools.\n` +
              `Please update to Node >=6 and npm >=3 to get supported tools in new projects.\n`
          )
        );
      }
		})
		.catch(reason => {
      console.log();
      console.log('Aborting installation.');
      if (reason.command) {
        console.log(`  ${chalk.cyan(reason.command)} has failed.`);
      } else {
        console.log(chalk.red('Unexpected error. Please report it as a bug:'));
        console.log(reason);
      }
      console.log();

      // On 'exit' we will delete these files from target directory.
      const knownGeneratedFiles = ['package.json', 'yarn.lock', 'node_modules'];
      const currentFiles = fs.readdirSync(path.join(root));
      currentFiles.forEach(file => {
        knownGeneratedFiles.forEach(fileToMatch => {
          // This remove all of knownGeneratedFiles.
          if (file === fileToMatch) {
            console.log(`Deleting generated file... ${chalk.cyan(file)}`);
            fs.removeSync(path.join(root, file));
          }
        });
      });
      const remainingFiles = fs.readdirSync(path.join(root));
      if (!remainingFiles.length) {
        // Delete target folder if empty
        console.log(
          `Deleting ${chalk.cyan(`${appName}/`)} from ${chalk.cyan(
            path.resolve(root, '..')
          )}`
        );
        process.chdir(path.resolve(root, '..'));
        fs.removeSync(path.join(root));
      }
      console.log('Done.');
      process.exit(1);
    });
}

// 获取要安装的react-scripts版本或者开发者自己定义的react-scripts
function getInstallPackage(version, originalDirectory) {
	let packageToInstall = 'react-scripts';  // 定义常量 packageToInstall，默认就是标准`react-scripts`包名
	const validSemver = semver.valid(version);  //  检验版本号是否合法
	if (validSemver) {
		packageToInstall += `@${validSemver}`;  // 合法的话执行，就安装指定版本，在`npm install`安装的时候指定版本为加上`@x.x.x`版本号，安装指定版本的`react-scripts`
	} else if (version) {
    if (version[0] === '@' && version.indexOf('/') === -1) {
      packageToInstall += version;
    } else if (version.match(/^file:/)) {
			// 不合法并且版本号参数带有`file:`执行以下代码，作用是指定安装包为我们自身定义的包
      packageToInstall = `file:${path.resolve(
        originalDirectory,
        version.match(/^file:(.*)?$/)[1]
      )}`;
    } else {
      // for tar.gz or alternative paths
      packageToInstall = version;
    }
	}
	return packageToInstall;
}

// 返回一个正常的依赖包名
function getPackageName(installPackage) {
	if (installPackage.match(/^.+\.(tgz|tar\.gz)$/)) {
		return getTemporaryDirectory()
			.then(obj => {
				let stream;
				if (/^http/.test(installPackage)) {
          stream = hyperquest(installPackage);
        } else {
          stream = fs.createReadStream(installPackage);
        }
        return extractStream(stream, obj.tmpdir).then(() => obj);
			})
			.then(obj => {
				const packageName = require(path.join(obj.tmpdir, 'package.json')).name;
        obj.cleanup();
        return packageName;
			})
			.catch(err => {
        // The package name could be with or without semver version, e.g. react-scripts-0.2.0-alpha.1.tgz
        // However, this function returns package name only without semver version.
        console.log(
          `Could not extract the package name from the archive: ${err.message}`
        );
        const assumedProjectName = installPackage.match(
          /^.+\/(.+?)(?:-\d+.+)?\.(tgz|tar\.gz)$/
        )[1];
        console.log(
          `Based on the filename, assuming it is "${chalk.cyan(
            assumedProjectName
          )}"`
        );
        return Promise.resolve(assumedProjectName);
      });
	} else if (installPackage.indexOf('git+') === 0) {
    // Pull package name out of git urls e.g:
    // git+https://github.com/mycompany/react-scripts.git
    // git+ssh://github.com/mycompany/react-scripts.git#v1.2.3
    return Promise.resolve(installPackage.match(/([^/]+)\.git(#.*)?$/)[1]);
  } else if (installPackage.match(/.+@/)) {
    // Do not match @scope/ when stripping off @version or @tag
    return Promise.resolve(
      installPackage.charAt(0) + installPackage.substr(1).split('@')[0]
    );
  } else if (installPackage.match(/^file:/)) {
    const installPackagePath = installPackage.match(/^file:(.*)?$/)[1];
    const installPackageJson = require(path.join(
      installPackagePath,
      'package.json'
    ));
    return Promise.resolve(installPackageJson.name);
  }
  return Promise.resolve(installPackage);
}

// 创建一个临时目录
function getTemporaryDirectory() {
	return new Promise((resolve, reject) => {
		tmp.dir({ unsafeCleanup: true }, (err, tmpdir, callback) => {
			if (err) {
        reject(err);
      } else {
        resolve({
          tmpdir: tmpdir,
          cleanup: () => {
            try {
              callback();
            } catch (ignored) {
              // Callback might throw and fail, since it's a temp directory the
              // OS will clean it up eventually...
            }
          },
        });
      }
		});
	});
}

// 将流中的data提取出来
function extractStream(stream, dest) {
  return new Promise((resolve, reject) => {
    stream.pipe(
      unpack(dest, err => {
        if (err) {
          reject(err);
        } else {
          resolve(dest);
        }
      })
    );
  });
}

// 检查网络连接是否正常
function checkIfOnline(useYarn) {
	if (!useYarn) {
    // Don't ping the Yarn registry.
    // We'll just assume the best case.
    return Promise.resolve(true);
	}
	
	return new Promise(resolve => {
		dns.lookup('registry.yarnpkg.com', err => {
			let proxy;
      if (err != null && (proxy = getProxy())) {
        // If a proxy is defined, we likely can't resolve external hostnames.
        // Try to resolve the proxy name as an indication of a connection.
        dns.lookup(url.parse(proxy).hostname, proxyErr => {
          resolve(proxyErr == null);
        });
      } else {
        resolve(err == null);
      }
		});
	});
}
function getProxy() {
  if (process.env.https_proxy) {
    return process.env.https_proxy;
  } else {
    try {
      // Trying to read https-proxy from .npmrc
      let httpsProxy = execSync('npm config get https-proxy')
        .toString()
        .trim();
      return httpsProxy !== 'null' ? httpsProxy : undefined;
    } catch (e) {
      return;
    }
  }
}

// 安装开发依赖包
function install(
	root,
	useYarn,
	usePnp,
	dependencies,
	verbose,
	isOnline
) {
	return new Promise((resolve, reject) => {
		let command; // 定义一个命令
		let args;  // 定义一个命令的参数
		if (useYarn) {
      command = 'yarnpkg';
      args = ['add', '--exact'];
      if (!isOnline) {
        args.push('--offline');
      }
      if (usePnp) {
        args.push('--enable-pnp');
      }
      [].push.apply(args, dependencies);

      // Explicitly set cwd() to work around issues like
      // https://github.com/facebook/create-react-app/issues/3326.
      // Unfortunately we can only do this for Yarn because npm support for
      // equivalent --prefix flag doesn't help with this issue.
      // This is why for npm, we run checkThatNpmCanReadCwd() early instead.
      args.push('--cwd');
      args.push(root);

      if (!isOnline) {
        console.log(chalk.yellow('You appear to be offline.'));
        console.log(chalk.yellow('Falling back to the local Yarn cache.'));
        console.log();
      }
    } else {
      command = 'npm';
      args = [
        'install',
        '--save',
        '--save-exact',
        '--loglevel',
        'error',
      ].concat(dependencies);

      if (usePnp) {
        console.log(chalk.yellow("NPM doesn't support PnP."));
        console.log(chalk.yellow('Falling back to the regular installs.'));
        console.log();
			}
		}

		if (verbose) {
			args.push('--verbose');
		}

		// 把命令组合起来执行
		const child = spawn(command, args, { stdio: 'inherit' });
		// 执行完命令后关闭
		child.on('close', code => {
			// code 为0代表正常关闭，不为零就打印命令执行错误的那条
      if (code !== 0) {
        reject({
          command: `${command} ${args.join(' ')}`,
        });
        return;
      }
      resolve();
    });
	});
}

// 检查node版本
function checkNodeVersion(packageName) {
	const packageJsonPath = path.resolve(
		process.cwd(),
		'node_modules',
		packageName,
		'package.json'
	);

	if (!fs.existsSync(packageJsonPath)) {
    return;
	}

	const packageJson = require(packageJsonPath);
  if (!packageJson.engines || !packageJson.engines.node) {
    return;
	}
	// 比较进程的`Node`版本信息和最小支持的版本，如果不满足版本条件，会报错然后退出进程
	if (!semver.satisfies(process.version, packageJson.engines.node)) {
    console.error(
      chalk.red(
        'You are running Node %s.\n' +
          'Create React App requires Node %s or higher. \n' +
          'Please update your version of Node.'
      ),
      process.version,
      packageJson.engines.node
    );
    process.exit(1);
	}
	
}

function setCaretRangeForRuntimeDeps(packageName) {
	// 取出创建项目的目录中的`package.json`路径
  const packagePath = path.join(process.cwd(), 'package.json');
  const packageJson = require(packagePath);

	// 判断其中`dependencies`是否存在，不存在代表我们的开发依赖没有成功安装
  if (typeof packageJson.dependencies === 'undefined') {
    console.error(chalk.red('Missing dependencies in package.json'));
    process.exit(1);
  }

  const packageVersion = packageJson.dependencies[packageName];
  if (typeof packageVersion === 'undefined') {
    console.error(chalk.red(`Unable to find ${packageName} in package.json`));
    process.exit(1);
  }
	// 检查`react` `react-dom` 的版本 
  makeCaretRange(packageJson.dependencies, 'react');
  makeCaretRange(packageJson.dependencies, 'react-dom');

  fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + os.EOL);
}

// 用来对依赖的版本做检测
function makeCaretRange(dependencies, name) {
  const version = dependencies[name];

  if (typeof version === 'undefined') {
    console.error(chalk.red(`Missing ${name} dependency in package.json`));
    process.exit(1);
  }

  let patchedVersion = `^${version}`;

  if (!semver.validRange(patchedVersion)) {
    console.error(
      `Unable to patch ${name} dependency version because version ${chalk.red(
        version
      )} will become invalid ${chalk.red(patchedVersion)}`
    );
    patchedVersion = version;
  }

  dependencies[name] = patchedVersion;
}

function executeNodeScript({ cwd, args }, data, source) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [...args, '-e', source, '--', JSON.stringify(data)],
      { cwd, stdio: 'inherit' }
    );

    child.on('close', code => {
      if (code !== 0) {
        reject({
          command: `node ${args.join(' ')}`,
        });
        return;
      }
      resolve();
    });
  });
}
