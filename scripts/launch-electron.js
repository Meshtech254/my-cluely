const { spawn } = require('child_process');
delete process.env.ELECTRON_RUN_AS_NODE;
const electronPath = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
  windowsHide: false
});

child.on('error', (error) => {
  console.error(`Could not launch Electron: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
