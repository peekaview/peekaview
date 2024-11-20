<template>
  <div class="about-container">
    <h1>Impressum</h1>
    
    <section>
      <h2>Angaben gemäß § 5 TMG</h2>
      <p>Limtec GmbH</p>
      <p>Halderstraße 16</p>
      <p>86150 Augsburg</p>
      <p>Deutschland</p>
    </section>

    <section>
      <p>Registergericht Augsburg</p>
      <p>HRB 30954</p>
      <p>UstID: DE 236898869</p>
    </section>

    <section>
    <h2>Vertreten durch</h2>
    <p>Geschäftsführer: Patrick Noack</p>
    </section>

    <section>
      <h2>Kontakt</h2>
      <p>Telefon: +49 (0)821 - 32871103</p>
      <p>E-Mail: info@limtec.de</p>
    </section>

    <section>
      <h2>Streitschlichtung</h2>
      <p>Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit: 
        <a href="https://ec.europa.eu/consumers/odr" target="_blank">https://ec.europa.eu/consumers/odr</a></p>
      <p>Unsere E-Mail-Adresse finden Sie oben im Impressum.</p>
      <p>Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>
    </section>
  </div>
</template>

<style scoped>
.about-container {
  max-width: 800px;
  margin: 2rem auto;
  padding: 0 1rem;
}

section {
  margin-bottom: 2rem;
}

h1 {
  margin-bottom: 2rem;
  color: var(--primary-color);
}

h2 {
  font-size: 1.2rem;
  margin-bottom: 1rem;
  color: var(--primary-color);
}

p {
  margin-bottom: 0.5rem;
}

a {
  color: var(--primary-color);
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}
</style>
