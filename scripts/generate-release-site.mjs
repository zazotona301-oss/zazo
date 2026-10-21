import { mkdir, writeFile } from 'node:fs/promises'

const repository = process.env.GITHUB_REPOSITORY
const token = process.env.GITHUB_TOKEN
if (!repository || !token) {
  throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required to build the release catalog.')
}

const releases = []
for (let page = 1; page <= 10; page += 1) {
  const response = await fetch(
    `https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Zazo-GitHub-Pages-Release-Catalog',
      },
    },
  )
  if (!response.ok) {
    throw new Error(`GitHub releases API returned HTTP ${response.status}.`)
  }
  const pageReleases = await response.json()
  releases.push(...pageReleases.filter((release) => !release.draft))
  if (pageReleases.length < 100) break
}

const rows = releases.map((release) => ({
  tag: release.tag_name,
  name: release.name || release.tag_name,
  publishedAt: release.published_at,
  releaseUrl: release.html_url,
  prerelease: release.prerelease,
  assets: release.assets
    .filter((asset) => /\.(apk|aab)$/i.test(asset.name))
    .map((asset) => ({
      name: asset.name,
      url: asset.browser_download_url,
      size: asset.size,
      type: asset.name.toLowerCase().endsWith('.apk') ? 'apk' : 'aab',
    })),
})).filter((release) => release.assets.length > 0)

await mkdir('site', { recursive: true })
await writeFile('site/releases.json', `${JSON.stringify(rows, null, 2)}\n`)
console.log(`Wrote GitHub Pages catalog with ${rows.length} release(s).`)
