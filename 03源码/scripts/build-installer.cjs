const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const source = path.resolve(__dirname, '..');
const workspace = path.resolve(source, '..');
const builder = path.join(source, 'build-tools/node_modules/electron-builder/out/cli/cli.js');
if (!fs.existsSync(builder)) {
  throw new Error('请先安装构建工具：npm.cmd install --prefix 03源码/build-tools --ignore-scripts --cache 04备份/构建缓存/npm');
}
const appBuild = spawnSync(process.execPath, [path.join(__dirname, 'build-asar.cjs')], { stdio: 'inherit' });
if (appBuild.status !== 0) process.exit(appBuild.status || 1);
const version = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8')).version;
const prepare = spawnSync(process.execPath, [path.join(__dirname, 'prepare-distribution.cjs')], { stdio: 'inherit' });
if (prepare.status !== 0) process.exit(prepare.status || 1);
const result = spawnSync(process.execPath, [builder,
  '--projectDir', source,
  '--config', path.join(source, 'electron-builder.json'),
  '--prepackaged', path.join(workspace, '04备份/构建缓存/打包输入', version),
  '--win', 'nsis', '--x64', '--publish', 'never'
], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_BUILDER_CACHE: path.join(workspace, '04备份/构建缓存/electron-builder') }
});
if (result.status !== 0 || result.error) process.exit(result.status || 1);
const output = path.join(workspace, '02安装包', version);
const artifacts = path.join(workspace, '04备份/构建缓存/安装包构建', version);
fs.mkdirSync(artifacts, { recursive: true });
for (const filename of fs.readdirSync(output)) {
  if (filename.endsWith('.blockmap') || filename === 'builder-debug.yml') {
    fs.copyFileSync(path.join(output, filename), path.join(artifacts, filename));
    fs.unlinkSync(path.join(output, filename));
  }
}
const installer = `小笺-安装版-${version}-x64.exe`;
const hash = require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(output, installer))).digest('hex');
fs.writeFileSync(path.join(output, 'SHA256.txt'), `${hash}  ${installer}\n`);
console.log(`安装包已生成：${path.join(output, installer)}`);
