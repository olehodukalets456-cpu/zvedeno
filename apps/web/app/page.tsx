import Link from "next/link";
import { AmbientVisual } from "./ambient-visual";

const features = [
  {
    number: "01",
    title: "Один проєкт — тільки його дані",
    description: "Кабінети, кампанії, креативи й конфіг звіту ізольовані за project ID. Чужі вкладки та правила не підмішуються."
  },
  {
    number: "02",
    title: "AI читає контекст, а не лише неймінг",
    description: "Система зіставляє назви, цілі, Meta events, метрики, оголошення й доступні превʼю креативів."
  },
  {
    number: "03",
    title: "Міні-кейтаро, який збирає себе сам",
    description: "Офери, воронки, result metric і стартові групування формуються під конкретний бізнес та лишаються керованими."
  }
];

export default function HomePage() {
  return (
    <div className="aiShell">
      <div className="aiAmbient" aria-hidden="true"><i /><i /><i /></div>
      <header className="aiTopbar">
        <Link className="aiBrand" href="/"><span className="aiBrandMark" />Zvedeno</Link>
        <nav className="aiNav" aria-label="Основна навігація">
          <Link href="/setup/accounts">Проєкти</Link>
          <Link href="/users">Користувачі</Link>
          <Link className="aiPrimary" href="/setup">Підключити Meta</Link>
        </nav>
      </header>

      <main>
        <section className="aiHeroHome">
          <AmbientVisual />
          <div className="aiHeroCopy">
            <div className="eyebrow">AI REPORTING WORKSPACE</div>
            <h1>Реклама в Meta. <em>Зведена без ручної пиздні.</em></h1>
            <p className="lead">
              Обираєш рекламні кабінети, описуєш бізнес і отримуєш індивідуальний міні-кейтаро.
              AI аналізує структуру акаунта, кампанії, результати та креативи, а не копіює чужий шаблон.
            </p>
            <div className="aiHeroActions">
              <Link className="primaryButton aiPrimary" href="/setup/accounts">Створити AI-проєкт</Link>
              <Link className="secondaryButton aiSecondary" href="/users">Керувати командою</Link>
              <span className="aiHeroMeta">PROJECT-SCOPED · META-NATIVE · LIVING REPORTS</span>
            </div>
          </div>
        </section>

        <section className="section aiHomeSection">
          <div className="sectionHeading">
            <span>Project intelligence</span>
            <h2>Звіт формується з реального контексту кабінету.</h2>
          </div>
          <div className="aiFeatureGrid">
            {features.map((feature) => (
              <article className="aiFeatureCard" key={feature.number}>
                <b>{feature.number}</b>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="section aiHomeSplit">
          <div className="sectionHeading">
            <span>Controlled AI</span>
            <h2>AI пропонує логіку. Дані й рішення залишаються під контролем.</h2>
          </div>
          <div className="aiHomeFlow">
            <div><small>INPUT</small><strong>Вибрані Meta-кабінети</strong></div>
            <span>→</span>
            <div><small>ANALYSIS</small><strong>Кампанії + events + креативи</strong></div>
            <span>→</span>
            <div><small>OUTPUT</small><strong>Персональний міні-кейтаро</strong></div>
          </div>
        </section>
      </main>
    </div>
  );
}
