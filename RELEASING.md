# Publishing a Violet update

Violet updates itself from GitHub Releases on this repo.

1. Make the code changes.
2. Write what changed (user-friendly bullets) in `release-notes.md`. Violet shows this as "What's new".
3. Bump nothing by hand: the version comes from the tag.
4. Commit, tag and push:
   ```bash
   git add -A && git commit -m "Violet 4.6.0: <summary>"
   git tag v4.6.0
   git push origin main --tags
   ```
5. GitHub Actions (`.github/workflows/release.yml`) builds the Windows installer on `windows-latest`
   and publishes the release with `latest.yml`. It takes about 5 to 8 minutes. Check the Actions tab.
6. Each installed copy of Violet checks every 4 hours (and one minute after it starts). It downloads the update,
   then installs it silently while Violet is hidden and idle, or when the user clicks "Update to …".

Rules:
- The new tag must be HIGHER than the last release (4.5.0 → 4.5.1 → 4.6.0), or Violet won't see it.
- No manual alternative needed: Actions tab → "Release Violet" → Run workflow (type a version + notes).
- The repo must stay public, or Violet would need a GitHub token to download releases.
