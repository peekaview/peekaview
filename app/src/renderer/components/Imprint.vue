<template>
  <div class="info-container" @click="$emit('close')">
    <div class="panel" @click.stop>
      <div class="close-button" @click="$emit('close')">×</div>
      <h1>Impressum</h1>
      
      <section>
        <h2>Angaben gemäß § 5 TMG</h2>
        <p>
          Limtec GmbH<br>
          Halderstraße 16<br>
          86150 Augsburg<br>
          Deutschland
        </p>
      </section>

      <section>
        <p>
          Registergericht Augsburg<br>
          HRB 30954<br>
          UstID: DE 236898869
        </p>
      </section>

      <section>
      <h2>Vertreten durch</h2>
      <p>Geschäftsführer: Patrick Noack</p>
      </section>

      <section>
        <h2>Kontakt</h2>
        <p>
          Telefon: +49 (0)821 - 32871103<br>
          E-Mail: info@limtec.de
        </p>
      </section>

      <section>
        <h2>Streitschlichtung</h2>
        <p>Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit: 
          <a href="https://ec.europa.eu/consumers/odr" target="_blank">https://ec.europa.eu/consumers/odr</a></p>
        <p>Unsere E-Mail-Adresse finden Sie oben im Impressum.</p>
        <p>Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>
      </section>
    </div>
  </div>
</template>