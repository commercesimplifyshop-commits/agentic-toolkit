import { Link, useParams } from 'react-router-dom'
import { FlowStory } from '../tutorial/FlowStory'
import { CONSTRUCTION, CUSTOMIZATIONS, GLOSSARY, VERIFY_NOTE } from '../tutorial/content'

/** Guide for someone new to Salesforce B2C: how a solution is built, and the customizations clients ask for most. */
export function TutorialPage() {
  const { id = '', topic } = useParams()
  const tab = topic === 'customizacoes' ? 'customizacoes' : 'construcao'

  return (
    <div className="sf-page sf-tut">
      <div className="sf-page-head">
        <div className="sf-page-title">
          <h1>Tutorial Salesforce B2C Commerce</h1>
          <p>Para quem chega ao projeto: como uma solução é montada e como responder às customizações mais pedidas.</p>
        </div>
      </div>

      <div className="sf-tabs">
        <Link className={`sf-tab ${tab === 'construcao' ? 'on' : ''}`} to={`/w/${id}/tutorial`}>
          Como é construída uma solução
        </Link>
        <Link className={`sf-tab ${tab === 'customizacoes' ? 'on' : ''}`} to={`/w/${id}/tutorial/customizacoes`}>
          Customizações frequentes
        </Link>
      </div>

      {tab === 'construcao' ? <Construction /> : <Customizations />}
    </div>
  )
}

function Construction() {
  return (
    <>
      <p className="sf-tut-lead">
        Uma solução Salesforce B2C passa pelos mesmos oito passos, do negócio à produção. Clique em um passo ou deixe a animação correr.
      </p>
      <FlowStory steps={CONSTRUCTION} label="Passos para construir uma solução Salesforce B2C" />

      <div className="sf-section-title" style={{ marginTop: 26 }}>
        Glossário rápido
      </div>
      <div className="sf-tut-glossary">
        {GLOSSARY.map((g) => (
          <div key={g.term} className="sf-card" style={{ padding: 14 }}>
            <strong>{g.term}</strong>
            <p>{g.meaning}</p>
          </div>
        ))}
      </div>

      <div className="sf-callout orange" style={{ marginTop: 18 }}>
        {VERIFY_NOTE}
      </div>
    </>
  )
}

function Customizations() {
  const { id = '' } = useParams()
  return (
    <>
      <p className="sf-tut-lead">
        Os pedidos mais comuns chegam em linguagem de negócio. Cada um abaixo mostra o caminho da requisição, o que muda no Business Manager e no código, e os erros que costumam aparecer.
      </p>
      <div className="sf-tut-index">
        {CUSTOMIZATIONS.map((c) => (
          <a key={c.id} href={`#${c.id}`} className="sf-chip">
            {c.title}
          </a>
        ))}
      </div>

      {CUSTOMIZATIONS.map((c) => (
        <section key={c.id} id={c.id} className="sf-card sf-tut-custom">
          <h2>{c.title}</h2>
          <blockquote className="sf-tut-request">{c.request}</blockquote>
          <p>
            <strong>Resposta curta:</strong> {c.answer}
          </p>
          <FlowStory steps={c.flow} label={`Fluxo: ${c.title}`} />
          <div className="sf-section-title" style={{ marginTop: 16 }}>
            Armadilhas comuns
          </div>
          <ul className="sf-tut-pitfalls">
            {c.pitfalls.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </section>
      ))}

      <div className="sf-callout orange" style={{ marginTop: 18 }}>
        {VERIFY_NOTE}{' '}
        <Link to={`/w/${id}/sfcc/instance`}>Veja o perfil da sua instância</Link>.
      </div>
    </>
  )
}
