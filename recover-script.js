/**
 * SCRIPT DI RECUPERO TIPOLOGICI - Versione Console
 *
 * ISTRUZIONI:
 * 1. Apri l'applicazione nel browser (https://opimappa.vercel.app o localhost)
 * 2. Effettua il login
 * 3. Apri gli Strumenti per Sviluppatori (F12)
 * 4. Vai nella tab "Console"
 * 5. Copia e incolla questo script COMPLETO nella console e premi Invio
 */

(async function recoverTypologies() {
  console.log('🔧 === SCRIPT DI RECUPERO TIPOLOGICI ===');
  console.log('');

  try {
    // Invece di importare, accediamo agli oggetti dal window
    // Prima dobbiamo esporli. Chiediamo all'utente di farlo.

    if (!window.__RECOVERY_MODE__) {
      console.log('📋 PRIMA DI PROCEDERE, ESEGUI QUESTI COMANDI:');
      console.log('');
      console.log('Copia e incolla questi 3 comandi uno alla volta:');
      console.log('');
      console.log('1️⃣ Prima esporta il client Supabase:');
      console.log('%c   (Vai nella tab Sources/Sorgenti -> cerca "supabase" nei file -> cerca la variabile "supabase" o "client" -> copiala qui sotto)', 'color: orange');
      console.log('');
      console.log('2️⃣ Poi esporta il database IndexedDB:');
      console.log('%c   (Cerca "database.ts" -> cerca "export const db" -> copialo qui sotto)', 'color: orange');
      console.log('');
      console.log('❌ METODO ALTERNATIVO PIÙ SEMPLICE:');
      console.log('');
      console.log('Usa direttamente l\'interfaccia web aprendo:');
      console.log('%c   http://localhost:5173/recover-typologies.html', 'color: green; font-weight: bold');
      console.log('   oppure');
      console.log('%c   https://opimappa.vercel.app/recover-typologies.html', 'color: green; font-weight: bold');
      console.log('');
      return;
    }

    const supabase = window.__RECOVERY_SUPABASE__;
    const db = window.__RECOVERY_DB__;
    const updateProject = window.__RECOVERY_UPDATE_PROJECT__;

    if (!supabase || !db || !updateProject) {
      console.error('❌ Oggetti non disponibili. Usa l\'interfaccia web invece.');
      return;
    }

    // Procedi con il recupero...
    console.log('1️⃣ Verifico autenticazione...');
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      console.error('❌ ERRORE: Utente non autenticato.');
      console.error('   Effettua il login nell\'applicazione prima di eseguire questo script.');
      return;
    }

    console.log(`✅ Autenticato come: ${session.user.email}`);
    console.log('');

    console.log('2️⃣ Carico progetti da Supabase...');
    const { data: supabaseProjects, error } = await supabase
      .from('projects')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('❌ Errore nel caricamento:', error.message);
      return;
    }

    if (!supabaseProjects || supabaseProjects.length === 0) {
      console.error('❌ Nessun progetto trovato su Supabase');
      return;
    }

    console.log(`✅ Trovati ${supabaseProjects.length} progetti su Supabase`);
    console.log('');

    const projectsWithTypologies = supabaseProjects.filter(p =>
      p.typologies && p.typologies.length > 0
    );

    console.log(`📊 Progetti con tipologici: ${projectsWithTypologies.length}`);
    console.log('');

    if (projectsWithTypologies.length === 0) {
      console.warn('⚠️ Nessun progetto con tipologici trovato su Supabase');
      console.warn('   I dati potrebbero non essere stati sincronizzati prima della cancellazione');
      return;
    }

    console.log('📋 ELENCO PROGETTI CON TIPOLOGICI:');
    console.log('='.repeat(80));

    projectsWithTypologies.forEach((project, index) => {
      const typologyCount = project.typologies.length;
      console.log(`[${index}] ${project.title}`);
      console.log(`    ID: ${project.id}`);
      console.log(`    Tipologici: ${typologyCount}`);
      console.log(`    Ultimo aggiornamento: ${new Date(project.updated_at).toLocaleString()}`);
      console.log('');
    });

    console.log('='.repeat(80));
    console.log('');

    window.restoreProjectTypologies = async function(projectIndex) {
      const project = projectsWithTypologies[projectIndex];

      if (!project) {
        console.error(`❌ Indice ${projectIndex} non valido. Usa un numero tra 0 e ${projectsWithTypologies.length - 1}`);
        return;
      }

      console.log('');
      console.log(`🔄 Ripristino tipologici per: ${project.title}`);
      console.log(`   Tipologici da ripristinare: ${project.typologies.length}`);

      try {
        const localProject = await db.projects.get(project.id);

        if (!localProject) {
          console.error(`❌ Progetto non trovato nel database locale`);
          console.error(`   Sincronizza il progetto dall'applicazione prima di ripristinare i tipologici`);
          return;
        }

        console.log(`   Tipologici attuali nel locale: ${localProject.typologies?.length || 0}`);

        await updateProject(project.id, {
          typologies: project.typologies
        });

        console.log('');
        console.log('✅ ========================================');
        console.log('✅ RIPRISTINO COMPLETATO CON SUCCESSO!');
        console.log('✅ ========================================');
        console.log(`✅ Ripristinati ${project.typologies.length} tipologici`);
        console.log('✅ Ricarica la pagina (F5) per vedere i cambiamenti');
        console.log('');

        console.log('📋 TIPOLOGICI RIPRISTINATI:');
        console.table(project.typologies.map(t => ({
          'N.': t.number,
          'Supporto': t.supporto || '-',
          'Tipo Supporto': t.tipoSupporto || '-',
          'Attraversamento': t.attraversamento || '-',
          'Marca': t.marcaProdottoUtilizzato || '-',
          'Prodotti': t.prodottiSelezionati?.length || 0
        })));

      } catch (err) {
        console.error('❌ Errore durante il ripristino:', err.message);
        console.error(err);
      }
    };

    window.restoreAllTypologies = async function() {
      console.log('');
      console.log('🔄 RIPRISTINO DI TUTTI I PROGETTI...');
      console.log('');

      let successCount = 0;
      let errorCount = 0;
      let totalTypologies = 0;

      for (let i = 0; i < projectsWithTypologies.length; i++) {
        const project = projectsWithTypologies[i];

        try {
          console.log(`[${i + 1}/${projectsWithTypologies.length}] Ripristino: ${project.title}...`);

          const localProject = await db.projects.get(project.id);

          if (!localProject) {
            console.warn(`   ⚠️ Progetto non trovato nel database locale, skip`);
            errorCount++;
            continue;
          }

          await updateProject(project.id, {
            typologies: project.typologies
          });

          totalTypologies += project.typologies.length;
          successCount++;
          console.log(`   ✅ OK - ${project.typologies.length} tipologici ripristinati`);

        } catch (err) {
          errorCount++;
          console.error(`   ❌ Errore: ${err.message}`);
        }
      }

      console.log('');
      console.log('='.repeat(80));
      console.log('📊 RIEPILOGO RIPRISTINO');
      console.log('='.repeat(80));
      console.log(`✅ Progetti ripristinati con successo: ${successCount}`);
      console.log(`❌ Progetti con errori: ${errorCount}`);
      console.log(`📝 Totale tipologici ripristinati: ${totalTypologies}`);
      console.log('');
      console.log('✅ Ricarica la pagina (F5) per vedere i cambiamenti');
      console.log('='.repeat(80));
    };

    console.log('');
    console.log('🎯 COME PROCEDERE:');
    console.log('');
    console.log('Opzione 1 - Ripristina un singolo progetto:');
    console.log('   restoreProjectTypologies(INDEX)');
    console.log('   Esempio: restoreProjectTypologies(0)');
    console.log('');
    console.log('Opzione 2 - Ripristina TUTTI i progetti:');
    console.log('   restoreAllTypologies()');
    console.log('');

  } catch (error) {
    console.error('❌ Errore fatale:', error.message);
    console.error(error);
  }
})();
