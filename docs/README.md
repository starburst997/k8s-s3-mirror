# GitHub Pages Documentation Site

This directory contains the GitHub Pages site for the K8s S3 Mirror project.

## Publishing Steps

### 1. Enable GitHub Pages in Repository Settings

1. Push these changes to your main branch
2. Go to your repository on GitHub
3. Navigate to Settings → Pages
4. Under "Source", select "GitHub Actions"
5. The workflow will automatically deploy the site

### 2. Setting Up a Custom Domain (Optional)

#### Configure Your Domain:

1. **Rename the CNAME file:**
   ```bash
   mv docs/CNAME.example docs/CNAME
   ```

2. **Edit the CNAME file** with your desired subdomain:
   ```
   mirror.yourdomain.com
   ```

3. **Configure DNS** at your domain provider:
   - For a subdomain (e.g., `mirror.yourdomain.com`):
     Add a CNAME record pointing to `<your-github-username>.github.io`

   - For an apex domain (e.g., `yourdomain.com`):
     Add these A records:
     ```
     185.199.108.153
     185.199.109.153
     185.199.110.153
     185.199.111.153
     ```

4. **Commit and push** the CNAME file:
   ```bash
   git add docs/CNAME
   git commit -m "Add custom domain for GitHub Pages"
   git push origin main
   ```

5. **Wait for DNS propagation** (can take up to 24 hours)

6. **Enable HTTPS** in GitHub Pages settings once the domain is verified

## Site Structure

- `index.html` - Main landing page with modern gradient design
- `CNAME.example` - Template for custom domain configuration
- `README.md` - This documentation file

## Deployment

The site is automatically deployed via GitHub Actions when changes are pushed to the `docs/` directory or workflow files.

## Local Preview

To preview the site locally:

```bash
cd docs
python3 -m http.server 8000
# Then open http://localhost:8000 in your browser
```

## Customization

The site uses inline CSS for simplicity. Key areas to customize:

- **Colors**: Gradient is defined in the `.hero-background` and button styles
- **Content**: Update the features, tech stack, and descriptions in `index.html`
- **Links**: Update GitHub repository links if you fork the project