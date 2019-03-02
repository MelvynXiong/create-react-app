'use strict';

// 当promise被reject后， 但是没有相关的error处理函数时抛出
process.on('unhandledRejection', err => {
  throw err;
});

const fs = require('fs-extra');  // 外部依赖，增强的文件操作模块 加了对promise的支持
const path = require('path');
const chalk = require('chalk');
const execSync = require('child_process').execSync;  // 通过多进程来实现对多核CPU的利用
const spawn = require('react-dev-utils/crossSpawn');  // 用来执行node进程, node跨平台解决方案
const { defaultBrowsers } = require('react-dev-utils/browsersHelper');
const os = require('os');
const verifyTypeScriptSetup = require('./utils/verifyTypeScriptSetup');

function isInGitRepository() {
  try {
		// 使用git命令判断
    execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

function isInMercurialRepository() {
  try {
    execSync('hg --cwd . root', { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

// git初始化
function tryGitInit(appPath) {
	let didInit = false;
	try {
		execSync('git --version', { stdio: 'ignore' });
		// 如果已经有了版本控制文件，停止
    if (isInGitRepository() || isInMercurialRepository()) {
      return false;
    }

    execSync('git init', { stdio: 'ignore' });
    didInit = true;  // 改变状态

    execSync('git add -A', { stdio: 'ignore' });
    execSync('git commit -m "Initial commit from Create React App"', {
      stdio: 'ignore',
    });
    return true;
	} catch (e) {
		if (didInit) {
			try {
				fs.removeSync(path.join(appPath, '.git'));
			} catch (err) {
				// ignore
			}
		}
		return false;
	}
}

module.exports = function(
	appPath,   // 创建的项目的绝对路径
	appName,   // 项目的名称
	verbose,  
	originalDirectory,
	template
) {
	// require.resolve()返回该文件带有完整绝对路径的文件名
	// 当前包的路径
	const ownPath = path.dirname(
		require.resolve(path.join(__dirname, '..', 'package.json'))
	);
	// 项目的package.json
	const appPackage = require(path.join(appPath, 'package.json'));
	// 根据是否存在yarn.lock来判断是否使用yarn
	const useYarn = fs.existsSync(path.join(appPath, 'yarn.lock'));
	// Copy over some of the devDependencies
	appPackage.dependencies = appPackage.dependencies || {};
	// 判断是否使用typescript
	const useTypeScript = appPackage.dependencies['typescript'] != null;
	// Setup the script rules
	appPackage.scripts = {
		start: 'react-scripts start',
		build: 'react-scripts build',
		test: 'react-scripts test',
		eject: 'react-scripts eject',
	};
	// Setup the eslint config
	appPackage.eslintConfig = {
		extends: 'react-app',
	};

	// Setup the browsers list
	appPackage.browserslist = defaultBrowsers;

	// 写入对package.json的修改
	fs.writeFileSync(
		path.join(appPath, 'package.json'),
		JSON.stringify(appPackage, null, 2) + os.EOL
	);
	
	// 防止readme文件冲突
	const readmeExists = fs.existsSync(path.join(appPath, 'README.md'));
  if (readmeExists) {
    fs.renameSync(
      path.join(appPath, 'README.md'),
      path.join(appPath, 'README.old.md')
    );
	}
	
	// Copy the files for the user
	const templatePath = template
    ? path.resolve(originalDirectory, template)
    : path.join(ownPath, useTypeScript ? 'template-typescript' : 'template');
  if (fs.existsSync(templatePath)) {
		// 拷贝模板文件夹到项目目录
    fs.copySync(templatePath, appPath);
  } else {
    console.error(
      `Could not locate supplied template: ${chalk.green(templatePath)}`
    );
    return;
	}
	
	// 添加.gitignore 内容
	try {
		fs.moveSync(
			path.join(appPath, 'gitignore'),
			path.join(appPath, '.gitignore'),
			[]
		)
	} catch (err) {
		// Append if there's already a `.gitignore` file there
		if (err.code === 'EEXIST') {
			const data = fs.readFileSync(path.join(appPath, 'gitignore'));
			fs.appendFileSync(path.join(appPath, '.gitignore'), data);
			fs.unlinkSync(path.join(appPath, 'gitignore'));  // 删文件
		} else {
			throw err;
		}
	}

	let command;
	let args;

	// 组合命令
	if (useYarn) {
    command = 'yarnpkg';
    args = ['add'];
  } else {
    command = 'npm';
    args = ['install', '--save', verbose && '--verbose'].filter(e => e);
  }
	args.push('react', 'react-dom');
	
	// Install additional template dependencies, if present
	const templateDependenciesPath = path.join(
		appPath,
		'.template.dependencies.json'
	);
	if (fs.existsSync(templateDependenciesPath)) {
		const templateDependencies = require(templateDependenciesPath).dependencies;
		args = args.concat(
			Object.keys(templateDependencies).map(key => {
				return `${key}@${templateDependencies[key]}`;
			})
		);
		fs.unlinkSync(templateDependenciesPath);
	}

	if (!isReactInstalled(appPackage) || template) {
		console.log(`Installing react and react-dom using ${command}...`);
		console.log();
		
		// 执行命令
		const proc = spawn.sync(command, args, {stdio:'inherit'});
		// 打印错误信息
		if (proc.status !== 0) {
      console.error(`\`${command} ${args.join(' ')}\` failed`);
      return;
		}
	}

	if (useTypeScript) {
    verifyTypeScriptSetup();
	}

	if (tryGitInit(appPath)) {
    console.log();
    console.log('Initialized a git repository.');
	}

	// Display the most elegant way to cd.
  // This needs to handle an undefined originalDirectory for
  // backward compatibility with old global-cli's.
  let cdpath;
  if (originalDirectory && path.join(originalDirectory, appName) === appPath) {
    cdpath = appName;
  } else {
    cdpath = appPath;
  }

  // Change displayed command to yarn instead of yarnpkg
  const displayedCommand = useYarn ? 'yarn' : 'npm';

  console.log();
  console.log(`Success! Created ${appName} at ${appPath}`);
  console.log('Inside that directory, you can run several commands:');
  console.log();
  console.log(chalk.cyan(`  ${displayedCommand} start`));
  console.log('    Starts the development server.');
  console.log();
  console.log(
    chalk.cyan(`  ${displayedCommand} ${useYarn ? '' : 'run '}build`)
  );
  console.log('    Bundles the app into static files for production.');
  console.log();
  console.log(chalk.cyan(`  ${displayedCommand} test`));
  console.log('    Starts the test runner.');
  console.log();
  console.log(
    chalk.cyan(`  ${displayedCommand} ${useYarn ? '' : 'run '}eject`)
  );
  console.log(
    '    Removes this tool and copies build dependencies, configuration files'
  );
  console.log(
    '    and scripts into the app directory. If you do this, you can’t go back!'
  );
  console.log();
  console.log('We suggest that you begin by typing:');
  console.log();
  console.log(chalk.cyan('  cd'), cdpath);
  console.log(`  ${chalk.cyan(`${displayedCommand} start`)}`);
  if (readmeExists) {
    console.log();
    console.log(
      chalk.yellow(
        'You had a `README.md` file, we renamed it to `README.old.md`'
      )
    );
  }
  console.log();
  console.log('Happy hacking!');
};

function isReactInstalled(appPackage) {
  const dependencies = appPackage.dependencies || {};

  return (
    typeof dependencies.react !== 'undefined' &&
    typeof dependencies['react-dom'] !== 'undefined'
	);
}