import re

with open('public/artist/dashboard/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# We need to extract the content inside <main class="dashboard-layout"> ... </main>
main_match = re.search(r'(<main class="dashboard-layout">)(.*?)(</main>)', content, re.DOTALL)
if not main_match:
    print("Could not find main tag")
    exit(1)

main_content = main_match.group(2)

# Extract sections
# Each section starts with <section class="...block-..."> and ends with </section>
sections = {}
# Find all sections, preserving their preceding HTML comments
section_pattern = re.compile(r'(?:<!--[^>]*-->\s*)*<section[^>]*class="[^"]*block-([a-zA-Z0-9-]+)[^"]*"[^>]*>.*?</section>', re.DOTALL)

for match in section_pattern.finditer(main_content):
    block_id = match.group(1)
    full_str = match.group(0)
    # Ensure all section classes include 'dashboard-card' and 'block'
    full_str = re.sub(r'class="([^"]*?)"', lambda m: 'class="' + ' '.join(set(m.group(1).split() + ['dashboard-card', 'block'])) + '"', full_str, count=1)
    sections[block_id] = full_str

# Reconstruct
sidebar_blocks = ['identity', 'info-panel', 'actions']
main_blocks = ['quotes', 'gallery-admin', 'milestones', 'profile']

sidebar_html = '\n        '.join([sections[b] for b in sidebar_blocks if b in sections])
main_html = '\n        '.join([sections[b] for b in main_blocks if b in sections])

new_main_content = f"""
        <!-- LEFT SIDEBAR -->
        <aside class="dashboard-sidebar">
        {sidebar_html}
        </aside>

        <!-- RIGHT MAIN COLUMN -->
        <div class="dashboard-main-content">
        {main_html}
        </div>
    """

new_content = content[:main_match.start(2)] + new_main_content + content[main_match.end(2):]

with open('public/artist/dashboard/index.html', 'w', encoding='utf-8') as f:
    f.write(new_content)

print("Reordered successfully")
