# Reproducible V1 offline build

This procedure is preparation only, not release authorization. Use a clean archive of the final candidate SHA, never a working directory with .env, uploads, backups or private evidence. The exact SHA, image ID, Node version, package-lock hash and full migration list must accompany the package.

On a networked isolated build host, build the final Linux/amd64 runtime once using the repository Dockerfile, with `--build-arg GIT_REVISION=<final-sha>`. Inspect the resulting image, record its immutable ID, and export it with `docker save`. Include the tracked-source `git archive` and SHA256 manifest. Never include credentials or clinical data.

On the offline host, verify every archive SHA256, load the validated runtime with `docker load`, and verify its immutable image ID and revision label. Importing and running that exact artifact is the preferred reproducible delivery route; no rebuild is needed for deployment preparation.

If an offline source rebuild is explicitly required, extract the exact source archive into an empty build directory and use its `scripts/acceptance/Dockerfile.offline`. The imported, validated Linux runtime provides the matching locked development dependencies, native engines and OS packages; no npm install or apk download occurs:

```powershell
docker build --platform linux/amd64 --network none --pull=false `
  --build-arg VALIDATED_IMAGE=tahili-validated:<imported-image-tag> `
  --build-arg GIT_REVISION=<final-sha> `
  -f scripts/acceptance/Dockerfile.offline -t tahili-v1:<final-sha> .
```

Verify that this local tag resolves to the immutable image ID recorded in the manifest before building; reject a mismatch. Check that package-lock.json matches the validated dependency image's recorded source lock hash. Record the rebuilt image ID separately. Next.js build bytes/image IDs need not be identical across rebuilds; source, dependencies, architecture and migration inputs must be identical. The scope-closure candidate uses this offline route after a documented online OS-package failure; consult its FINAL_BUILD.json for the exact executed build and dependency image. No migrate command, container cutover, or rollback to old binaries is implied.
