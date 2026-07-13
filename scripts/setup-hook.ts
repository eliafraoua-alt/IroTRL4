import * as fs from 'fs';
import * as path from 'path';

function setupHook() {
  const root = process.cwd();
  const sourcePath = path.join(root, 'scripts', 'post-merge.hook');
  const destinationDir = path.join(root, '.git', 'hooks');
  const destinationPath = path.join(destinationDir, 'post-merge');

  console.log(`Checking source hook at: ${sourcePath}`);
  if (!fs.existsSync(sourcePath)) {
    console.error(`Error: Source hook file not found at ${sourcePath}`);
    process.exit(1);
  }

  // Check if .git directory exists
  const gitDir = path.join(root, '.git');
  if (!fs.existsSync(gitDir)) {
    console.log(`Warning: .git folder not found at ${gitDir}. Creating mocked .git/hooks directory for deployment portability.`);
    fs.mkdirSync(gitDir, { recursive: true });
  }

  // Ensure destinations hooks directory exists
  if (!fs.existsSync(destinationDir)) {
    fs.mkdirSync(destinationDir, { recursive: true });
  }

  // Copy hook file
  console.log(`Copying hook to: ${destinationPath}`);
  fs.copyFileSync(sourcePath, destinationPath);

  // Set executable permissions (0o755 = rwxr-xr-x)
  try {
    fs.chmodSync(destinationPath, 0o755);
    console.log(`Successfully set executable permissions on ${destinationPath}`);
  } catch (err: any) {
    console.warn(`Could not set chmod on hook: ${err.message || err}`);
  }

  console.log('Git hook configuration complete.');
}

setupHook();
