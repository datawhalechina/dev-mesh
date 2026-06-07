import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docs: [
    'intro',
    'getting-started',
    'knowledge-capture',
    'architecture',
    'deployment',
    'roadmap',
    {
      type: 'category',
      label: '参考',
      items: ['reference/cli', 'reference/env'],
    },
  ],
};

export default sidebars;
