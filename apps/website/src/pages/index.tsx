import clsx from 'clsx';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import styles from './index.module.css';

const flows = [
  {
    title: '本地优先',
    text: '知识先写入项目自己的 .dev-mesh 目录，团队可以审查、同步和迁移。',
  },
  {
    title: 'MCP 接入',
    text: 'Codex、Claude Code 和 opencode 通过本地 proxy 调用统一工具沉淀上下文。',
  },
  {
    title: '团队 Mesh',
    text: 'Hub Server 管理成员、项目、邀请、同步状态和跨项目经验检索。',
  },
];

const paths = [
  ['init', '创建项目级知识库'],
  ['proxy', '暴露本地 MCP 工具'],
  ['capture', '沉淀任务和决策'],
  ['search', '回收上下文给下一轮协作'],
];

export default function Home() {
  return (
    <Layout
      title="MCP Dev Mesh"
      description="面向 AI 协作开发的本地优先上下文网络"
    >
      <main>
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            <p className={styles.eyebrow}>Local-first context memory</p>
            <Heading as="h1" className={styles.heroTitle}>
              MCP Dev Mesh
            </Heading>
            <p className={styles.heroLead}>
              把 Codex、Claude Code、opencode 的项目经验沉淀到可审查、可同步、可检索的
              `.dev-mesh` 知识网络中。
            </p>
            <div className={styles.heroActions}>
              <Link className={clsx('button button--primary', styles.action)} to="/docs/getting-started">
                开始使用
              </Link>
              <Link className={clsx('button button--secondary', styles.action)} to="/docs/architecture">
                查看架构
              </Link>
            </div>
          </div>
        </section>

        <section className={styles.band}>
          <div className={styles.bandInner}>
            <div className={styles.sectionHeader}>
              <p className={styles.kicker}>Project memory that travels with the repo</p>
              <Heading as="h2">从一次对话，到长期项目上下文</Heading>
            </div>
            <div className={styles.flowGrid}>
              {flows.map((item) => (
                <article className={styles.flowItem} key={item.title}>
                  <Heading as="h3">{item.title}</Heading>
                  <p>{item.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.pathBand}>
          <div className={styles.pathInner}>
            <div>
              <p className={styles.kicker}>CLI and MCP workflow</p>
              <Heading as="h2">最小链路清晰可测</Heading>
              <p className={styles.pathCopy}>
                先用 CLI 完成 smoke test，再把 MCP proxy 接到 AI 工具。每条知识都可以回到
                项目文件里检查。
              </p>
            </div>
            <ol className={styles.pathList}>
              {paths.map(([command, text]) => (
                <li key={command}>
                  <code>dmx {command}</code>
                  <span>{text}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </main>
    </Layout>
  );
}
