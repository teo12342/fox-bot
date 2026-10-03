export function validateManifest(input) {
  if (!input || input.schemaVersion !== 1 || typeof input.version !== 'string' || !Array.isArray(input.artifacts) || !Array.isArray(input.gates)) throw new Error('Unsupported release manifest');
  for (const a of input.artifacts) {
    if (!['windows','linux','android'].includes(a.platform) || !['x64','arm64','universal'].includes(a.arch) || typeof a.format !== 'string' || !/^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\//.test(a.url) || !/^[a-f0-9]{64}$/.test(a.sha256) || !Number.isSafeInteger(a.size) || a.size <= 0) throw new Error('Invalid release artifact');
  }
  return input;
}
export function artifactFor(manifest, platform, arch, format) { return manifest.artifacts.find(a => a.platform === platform && a.arch === arch && a.format === format); }
