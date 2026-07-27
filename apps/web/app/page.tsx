import Link from "next/link";

const steps = [
  {
    number: "01",
    title: "Підключити Meta",
    description: "Обрати доступні рекламні кабінети. Старі й нові кабінети можуть належати одному проєкту."
  },
  {
    number: "02",
    title: "Обрати дані",
    description: "Кампанії, оголошення, креативи, результати, період, деталізація та частота оновлення."
  },
  {
    number: "03",
    title: "Налаштувати відповідності",
    description: "Підтвердити проєкти, напрямки та значення результатів для різних кампаній."
  },
  {
    number: "04",
    title: "Створити Google-звіт",
    description: "Один постійний звіт, який доповнюється, оновлює атрибуцію і не стирає історію."
  }
];

const guarantees = [
  "Історичні дані не очищаються під час синхронізації",
  "Новий рекламний кабінет продовжує історію того самого проєкту",
  "Креативи з однаковою назвою агрегуються між кабінетами",
  "Ручні Status, Comment і Final result не перезаписуються",
  "Невідомі результати потрапляють у чергу на мапінг, а не губляться"
];

export default function HomePage() {
  return (
    <main>
      <section className="hero">
        <div className="eyebrow">Meta reporting infrastructure</div>
        <h1>Клієнтські звіти, які не треба щотижня збирати заново.</h1>
        <p className="lead">
          Підключаєш Meta, обираєш дані та отримуєш постійну Google-таблицю зі статистикою,
          креативами, напрямками й історією всіх рекламних кабінетів.
        </p>
        <div className="actions">
          <Link className="primaryButton" href="/setup">Почати налаштування</Link>
          <span>Foundation v0.2</span>
        </div>
      </section>

      <section className="section">
        <div className="sectionHeading">
          <span>Простий сценарій</span>
          <h2>Чотири кроки замість ручної пізди зі звітами</h2>
        </div>
        <div className="stepGrid">
          {steps.map((step) => (
            <article className="step" key={step.number}>
              <div className="stepNumber">{step.number}</div>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section split">
        <div>
          <div className="sectionHeading">
            <span>Незламна історія</span>
            <h2>Кабінети змінюються. Проєкт і звіт залишаються.</h2>
          </div>
          <div className="flow" aria-label="Project continuity example">
            <div><strong>Project DMND</strong><small>Постійна сутність</small></div>
            <div className="arrow">→</div>
            <div><strong>Account A</strong><small>Blocked · history kept</small></div>
            <div className="arrow">+</div>
            <div><strong>Account B</strong><small>Active · new data</small></div>
          </div>
        </div>
        <ul className="guarantees">
          {guarantees.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>
    </main>
  );
}
