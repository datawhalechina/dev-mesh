import DefaultTheme from 'vitepress/theme';
import { h } from 'vue';
import { Aside, Card, CopyText, Footer, Links, Notice, Pill, Underline } from '@theojs/lumen';
import '@theojs/lumen/style';
import './custom.css';
import { asideData, footerData } from './lumen-data';
import HeroPanel from './HeroPanel.vue';

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'home-hero-info-before': () => h(Notice),
      'home-hero-image': () => h(HeroPanel),
      'aside-outline-before': () => h(Aside, { Aside_Data: asideData }),
      'layout-bottom': () => h(Footer, { Footer_Data: footerData }),
    });
  },
  enhanceApp({ app }) {
    app.component('Card', Card);
    app.component('CopyText', CopyText);
    app.component('Links', Links);
    app.component('Pill', Pill);
    app.component('Underline', Underline);
  },
};
