/**
 * SCRIPT DI RECUPERO TIPOLOGICI
 *
 * Questo script recupera i tipologici dal server Supabase e li ripristina nel database locale.
 *
 * ISTRUZIONI:
 * 1. Apri l'applicazione nel browser (deve essere in esecuzione)
 * 2. Apri gli Strumenti per Sviluppatori (F12)
 * 3. Vai nella tab "Console"
 * 4. Copia e incolla questo intero script nella console
 * 5. Segui le istruzioni che appaiono
 */

(async function recoverTypologies() {
  console.log('🔧 === SCRIPT DI RECUPERO TIPOLOGICI ===');
  console.log('');

  try {
    // Import required modules
    const { supabase } = await import('./src/lib/supabase.ts');
    const { db } = await import('./src/db/database.ts');
    const { updateProject } = await import('./src/db/projects.ts');

    // Check authentication
    console.log('1️⃣ Verifico autenticazione...');
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      console.error('❌ ERRORE: Utente non autenticato.');
      console.error('   Effettua il login nell\'applicazione prima di eseguire questo script.');
      return;
    }

    console.log(`✅ Autenticato come: ${session.user.email}`);
    console.log('');

    // Fetch all projects from Supabase
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

    // Filter projects with typologies
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

    // Display projects
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

    // Prepare restore function
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
        // Check if project exists locally
        const localProject = await db.projects.get(project.id);

        if (!localProject) {
          console.error(`❌ Progetto non trovato nel database locale`);
          console.error(`   Sincronizza il progetto dall'applicazione prima di ripristinare i tipologici`);
          return;
        }

        console.log(`   Tipologici attuali nel locale: ${localProject.typologies?.length || 0}`);

        // Update project
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

        // Show typologies details
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

    // Restore all projects function
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
      console.log('=' .repeat(80));
      console.log('📊 RIEPILOGO RIPRISTINO');
      console.log('='.repeat(80));
      console.log(`✅ Progetti ripristinati con successo: ${successCount}`);
      console.log(`❌ Progetti con errori: ${errorCount}`);
      console.log(`📝 Totale tipologici ripristinati: ${totalTypologies}`);
      console.log('');
      console.log('✅ Ricarica la pagina (F5) per vedere i cambiamenti');
      console.log('='.repeat(80));
    };

    // Instructions
    console.log('');
    console.log('🎯 COME PROCEDERE:');
    console.log('');
    console.log('Opzione 1 - Ripristina un singolo progetto:');
    console.log('   restoreProjectTypologies(INDEX)');
    console.log('   Esempio: restoreProjectTypologies(0)  // Ripristina il primo progetto');
    console.log('');
    console.log('Opzione 2 - Ripristina TUTTI i progetti:');
    console.log('   restoreAllTypologies()');
    console.log('');
    console.log('⚠️  IMPORTANTE: Dopo il ripristino, ricarica la pagina (F5) per vedere i cambiamenti');
    console.log('');

  } catch (error) {
    console.error('❌ Errore fatale:', error.message);
    console.error(error);
    console.log('');
    console.log('💡 SUGGERIMENTI:');
    console.log('   1. Assicurati di essere nell\'applicazione (non in una pagina vuota)');
    console.log('   2. Assicurati di aver fatto il login');
    console.log('   3. Prova a ricaricare la pagina e riprovare');
  }
})();
