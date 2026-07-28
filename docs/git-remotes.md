# inventory-app — Git remotes

| Method | URL / command |
|--------|----------------|
| **HTTPS** | `https://github.com/phyzioline/inventory-app.git` |
| **SSH** | `git@github.com:phyzioline/inventory-app.git` |
| **GitHub CLI** | `gh repo clone phyzioline/inventory-app` |

**Repo:** [github.com/phyzioline/inventory-app](https://github.com/phyzioline/inventory-app)  
**Server path:** `/home/phyzioline-inventory/htdocs/inventory.phyzioline.com`

## Push from server

HTTPS needs a valid `GITHUB_TOKEN` / PAT with `repo` scope. SSH needs a deploy key added to the repo (currently: no SSH key on this server).

```bash
cd /home/phyzioline-inventory/htdocs/inventory.phyzioline.com
pwd && git remote -v
git push origin main
```
