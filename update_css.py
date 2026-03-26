import re

with open('public/shared/css/dashboard.css', 'r', encoding='utf-8') as f:
    css = f.read()

# Replace the layout part
old_layout_pattern = re.compile(r'\.dashboard-grid \{.*?\}.*?/\* ============================================.*?\*/', re.DOTALL)
# Actually, the grid styles are scattered. Let's find `.dashboard-grid`, `.block-identity` grid-columns, etc.

# Let's replace .dashboard-grid with .dashboard-layout
css = css.replace('.dashboard-grid {', '.dashboard-layout {\n    display: grid;\n    grid-template-columns: 350px 1fr;\n    gap: 24px;\n    width: calc(100% - 4rem);\n    max-width: 1400px;\n    margin: 80px auto 40px;\n    align-items: start;\n    /* border: var(--border-width) solid var(--fg); -- Removed outer border */\n    background: transparent;\n}\n\n.dashboard-sidebar {\n    display: flex;\n    flex-direction: column;\n    gap: 24px;\n    position: sticky;\n    top: 100px;\n}\n\n.dashboard-main-content {\n    display: flex;\n    flex-direction: column;\n    gap: 24px;\n}\n\n.dashboard-card {\n    background: var(--bg);\n    border: 3px solid var(--fg);\n    border-radius: 0px; /* Bauhaus sharp corners */\n    box-shadow: 6px 6px 0px var(--fg);\n    /* transition: all 0.2s ease; */\n}\n\n/* Hide old display:none .dashboard-grid class if any */\n.dashboard-grid-old {', 1)

# Remove grid-column and grid-row from blocks
blocks_to_clean = ['block-identity', 'block-quotes', 'block-info-panel', 'block-profile', 'block-actions', 'block-gallery-admin', 'block-milestones']
for block in blocks_to_clean:
    css = re.sub(rf'\.{block} \{{[^}}]*grid-column:[^;]*;[^}}]*grid-row:[^;]*;', lambda m: m.group(0).replace(re.search(r'grid-column:[^;]*;', m.group(0)).group(0), '').replace(re.search(r'grid-row:[^;]*;', m.group(0)).group(0), ''), css)

# Update responsive layouts
css = re.sub(r'@media \(max-width: 1200px\) \{.*?\n\}', '''@media (max-width: 1200px) {
    .dashboard-layout {
        grid-template-columns: 300px 1fr;
    }
''', css, count=1)

css = re.sub(r'@media \(max-width: 768px\) \{.*?\n\}', '''@media (max-width: 768px) {
    body {
        padding: 0;
    }

    .dashboard-layout {
        display: flex;
        flex-direction: column;
        width: calc(100% - 2rem);
        margin: 0.75rem auto 80px;
        gap: 16px;
    }

    .dashboard-sidebar {
        position: static;
    }

    .dashboard-card {
        box-shadow: 4px 4px 0px var(--fg);
    }
''', css, count=1)

# Add some tweaks for Shadcn + Bauhaus look
css += '''
/* === SHADCN + BAUHAUS TWEAKS === */
.block-identity {
    padding: 2rem 1.5rem;
    border-bottom: 3px solid var(--fg); /* Restore inner borders if needed or just keep card borders */
}
/* Ensure the components inside don't break the new flex layout */
.block {
    /* If they had min-height, etc. */
}
'''

with open('public/shared/css/dashboard.css', 'w', encoding='utf-8') as f:
    f.write(css)

print("CSS updated")
