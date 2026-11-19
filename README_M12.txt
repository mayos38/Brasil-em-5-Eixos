BRASIL EM 5 EIXOS — MÓDULO 12 (PATCH)
====================================

CONTEÚDO
--------
- brasil-quiz/js/screens/campaign.js
- brasil-quiz/index.html (ativa o M12 depois do M11 e atualiza a ação do template de regiões)
- brasil-quiz/css/style.css (estilos adicionais da campanha)
- dev/integrated-preview.html (texto atualizado para M1–M12)
- dev/integrated-preview.js (loader do M15 intermediário atualizado para validar a presença do M12)
- docs/UI_CONTRACT.md
- PROGRESS.md
- tests/test_campaign_runtime.js
- tests/run_ui_structure.py

O QUE O M12 ENTREGA
-------------------
- Cinco regiões em sequência: Norte, Nordeste, Centro-Oeste, Sudeste e Sul.
- Educativo/Fácil, Normal, Médio e Difícil: cinco pontos temáticos por região, 10 perguntas em cada ponto.
- Geógrafo: três pontos com temas misturados por região, 10 perguntas em cada ponto.
- Metas regionais: Fácil/Educativo 50%, Normal 60%, Médio 60% (provisório, porque o esboço não definiu Médio), Difícil 70% e Geógrafo 70%.
- Repetição de pontos para melhorar a pontuação; o melhor placar do ponto é preservado e substituído somente por resultado maior. A melhor quantidade de acertos também é guardada para o desbloqueio regional.
- Todos os modos de dificuldade aparecem selecionáveis desde o início, conforme solicitado para o teste.
- Não inclui ponto de desafio, chefe, HP ou recompensa de chefe. Não inclui pausa.

INTEGRAÇÃO
-----------
O M12 assina intent:campaign do menu M8. Usa a partida M10 e a revisão/resultados M11. O loader do preview M15 intermediário foi atualizado para carregar e exigir o módulo de campanha antes do boot. Não duplica sorteio, timer, resposta ou pontuação: a autoridade continua no engine M5.6.

Para compatibilidade com o motor de campanha atual, o M12 faz uma adaptação somente durante a chamada síncrona de engine.start(): restringe temporariamente bank.list() à região/tema/tier, configura 10 perguntas e injeta a duração escolhida no campo normal do objeto de tempo. O M5.6 captura timeLimitMs na partida; em seguida, o M12 restaura as funções e valores originais. Por isso, o patch deve ser aplicado sobre a versão atual do GitHub que contém o M5.6, e não sobre um engine antigo.

Se o tier escolhido tiver menos de 10 perguntas, o ponto usa perguntas de outras faixas de dificuldade, mas mantém a região e o tema. Se o conjunto regional/temático todo tiver menos de 10, não inicia o ponto.

ATENÇÃO — GEÓGRAFO
------------------
A tela da região também informa esta limitação durante a seleção. Os três pontos de Geógrafo usam o pool de nível 4 da própria região. O motor evita repetir perguntas dentro de cada partida, mas não guarda histórico de IDs entre pontos distintos. Com o banco atual, algumas perguntas podem reaparecer em outro ponto Geógrafo da mesma região. Para eliminar essa repetição será necessário ampliar o banco de nível 4 ou criar uma reserva de questões suficiente para 30 perguntas únicas por região.

ATENÇÃO — MÉDIO
---------------
O esboço define corte de 60% para Normal, mas não especifica o corte da dificuldade Médio já existente na configuração. Nesta versão, Médio usa 60% por aproximação explícita. Ajuste em thresholdFor() se desejar outra regra.

COMO APLICAR NO GITHUB
----------------------
1. Faça backup/commit da branch main antes de aplicar.
2. Extraia o ZIP na raiz do repositório, preservando as pastas e sobrescrevendo somente os arquivos listados acima.
3. Confira o diff antes do commit. Não substitua os arquivos M5.6 (config.js, util.js, storage.js, bank.js, engine.js) nem data/questions.json.
4. Publique na branch main com GitHub Pages habilitado para a raiz.
5. Preview: https://mayos38.github.io/Brasil-em-5-Eixos/dev/integrated-preview.html

TESTE LOCAL ALTERNATIVO
-----------------------
Na raiz do repositório, execute:
  python -m http.server 8000
Depois abra:
  http://localhost:8000/dev/integrated-preview.html

TESTES INCLUÍDOS
----------------
  node tests/test_campaign_runtime.js
  python tests/run_ui_structure.py .

Os testes locais validam regras e estrutura, mas não substituem o teste real no navegador com o M5.6 e o banco atual de 508 questões.

COMO REMOVER DEPOIS DO TESTE
----------------------------
Reverta os arquivos modificados pelo patch ou remova apenas os aditivos M12:
- Remova <script src="js/screens/campaign.js"></script> de brasil-quiz/index.html.
- Remova brasil-quiz/js/screens/campaign.js.
- Remova o bloco final identificado como “Módulo 12” de brasil-quiz/css/style.css (ou reverta o arquivo CSS ao backup).
- Reverta dev/integrated-preview.html e dev/integrated-preview.js, docs/UI_CONTRACT.md, PROGRESS.md e os testes incluídos/alterados.
- Não remova nem altere os arquivos M5.6.

A chave localStorage bq5_campaign_v2 permanece no navegador após remover o módulo; pode ser apagada manualmente nas ferramentas do navegador caso queira limpar o progresso experimental.
