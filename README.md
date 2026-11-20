# Brasil em 5 Eixos

É um jogo de perguntas e respostas dedicado à Geografia do Brasil. A proposta é explorar diferentes aspectos do território brasileiro por meio de desafios, combinando conteúdo geográfico, progressão de dificuldade e uma experiência de jogo acessível — especialmente em dispositivos móveis.

O projeto está em desenvolvimento e passa por uma construção modular: cada parte do jogo tem seu módulo específico, com testes artificiais específicos e documentação para facilitar a manutenção e a expansão.

## A proposta

O Brasil é abordado a partir de cinco eixos temáticos:

* **Cultura** — manifestações culturais, patrimônio, identidade e diversidade brasileira.
* **Economia** — atividades produtivas, circulação, trabalho e organização econômica do território.
* **Animais** — fauna brasileira e suas relações com os diferentes ambientes.
* **Vegetação** — formações vegetais, biomas e características ambientais: Biogeografia por essência. O clima aparece como um sub assunto relacionado a este eixo, não como um sexto eixo selecionável - Troca de nome do eixo em versão futura.
* **Cidades** — urbanização, população, redes urbanas e organização do espaço urbano.

A intenção é transformar esses conteúdos em uma experiência interativa, na qual o jogador possa testar o que sabe, reconhecer a diversidade regional do país e aprender também ao revisar as respostas e suas explicações. O jogo foi pensado como um recurso lúdico que pode apoiar atividades educativas, sem se limitar a um formato de avaliação tradicional.
Também tem o propósito de ser um jogo divertido para aqueles que procuram algo casual, seja adquirindo conhecimentos novos, competindo ou passando o tempo.

**Testar o jogo:** [Abrindo a prévia](https://mayos38.github.io/Brasil-em-5-Eixos/dev/integrated-preview.html)

## Como o jogo funciona

Na modalidade solo atualmente implementada, o jogador configura a partida escolhendo os eixos, o nível de dificuldade e a quantidade de perguntas. Durante o jogo, cada questão apresenta quatro alternativas; o jogador seleciona uma opção e confirma a resposta.

Entre os recursos já implementados estão:

* Banco de questões externo em JSON, organizado por eixo e dificuldade.
* Quatro níveis de dificuldade, incluindo **Geógrafo**.
* Tempo de resposta varia conforme a dificuldade.
* Pontuação base e bônus limitado por rapidez.
* Embaralhamento das alternativas sem perder a correspondência com o gabarito.
* Controle para evitar repetição de questões dentro da partida.
* Feedback após a resposta e tratamento de tempo esgotado.
* Tela de resultados com pontuação, aproveitamento e desempenho por eixo.
* Revisão das questões, incluindo resposta escolhida, gabarito e explicação quando disponível.
* Histórico local das partidas, com limite de 60 registros, além de recursos de recorde e progresso previstos pelas APIs existentes.


## Os cinco eixos e o banco de questões

O banco oficial está em `brasil-quiz/data/questions.json` e, no registro de desenvolvimento de 18 de novembro de 2026, contém **508 questões** distribuídas entre os cinco eixos e quatro níveis de dificuldade.

O número de questões é consultado dinamicamente pelo próprio sistema. Portanto, 508 é a quantidade registrada nessa versão do banco, não um valor fixo usado pelas regras do jogo. O arquivo JSON é a fonte única dos enunciados e não deve ser duplicado em outros módulos.

A respeito da curadoria do banco, ela está sendo revisada por um acadêmico da área de Geografia, para a veracidade dos fatos, em especial, das dificuldade "Geógrafo"

## Estrutura técnica

O núcleo é desenvolvido com tecnologias web convencionais:

* **HTML** para a estrutura das telas e dos componentes.
* **CSS** para a identidade visual, os estados da interface e a responsividade.
* **JavaScript** organizado em módulos clássicos, carregados na ordem de suas dependências.
* **JSON** como formato do banco de questões.
* **localStorage**, com alternativa em memória quando o armazenamento do navegador não está disponível ou apresenta erro.

O projeto não depende de um framework JavaScript ou de um processo de build para organizar o código. Os módulos compartilham o namespace `BQ5` e se comunicam por APIs públicas e eventos, procurando manter separadas as regras do jogo, a persistência e a apresentação visual.

### Módulos do núcleo

|Módulo|Responsabilidade|
|-|-|
|M0 — Banco|Questões oficiais em `data/questions.json`.|
|M1 — Configuração|Eixos, dificuldades, pontuação, tempos e demais constantes.|
|M2 — Utilitários|Funções auxiliares independentes da interface.|
|M3 — Armazenamento|Persistência local e fallback em memória.|
|M4 — Banco de questões|Carregamento, validação, consulta e estatísticas do banco.|
|M5 — Motor do jogo|Seleção de questões, alternativas, tempo, respostas, pontuação e resultados.|
|M5.5 / M5.6|Planejamento visual e de recursos; ampliação do banco e ajustes de dificuldade/temporização.|
|M6 — Interface base|Estrutura HTML e estilos CSS.|
|M7 — Camada de UI|Navegação, histórico de telas, eventos, modais, notificações e ações.|
|M8 — Menu|Menu principal e acesso às modalidades.|
|M9 — Configuração|Preparação da partida solo.|
|M10 — Partida|Apresentação das perguntas, seleção, confirmação, cronômetro e feedback.|
|M11 — Resultados|Desempenho, revisão das respostas, histórico e replay solo.|

A arquitetura prevê ainda módulos próprios para campanha, multiplayer e inicialização final da aplicação. Eles estão identificados como etapas futuras no estado atual do projeto, em fase de amadurecimento de idéias, especialmente a campanha e o modo multiplayer.

## Executar a prévia integrada

Como o banco é carregado com `fetch()`, abrir os arquivos diretamente pelo endereço `file://` pode bloquear o carregamento. Para testar a prévia integrada, inicie um servidor HTTP simples na raiz do projeto:

```bash
python -m http.server 8000
```

Em seguida, acesse no navegador:

```text
http://localhost:8000/dev/integrated-preview.html
```

Essa página é uma **prévia de desenvolvimento**, não a inicialização definitiva do produto. Ela reúne os módulos reais já disponíveis e permite testar o fluxo solo integrado que está em construção. Os módulos futuros não passam a existir automaticamente por estarem previstos na arquitetura.

## Testes

O projeto possui suítes para validar o banco, o motor, o armazenamento, a interface e os fluxos de jogo. No ambiente de desenvolvimento documentado, os testes JavaScript são executados em V8 por meio do `py-mini-racer`, com scripts Python para preparar e executar cada suíte.

A partir da raiz do projeto, os principais comandos registrados são:

```bash
python tests/run\_bank.py
python tests/run\_engine.py
python tests/run\_storage.py
python tests/run\_ui\_menu.py
python tests/run\_setup\_play.py
python tests/run\_results\_v8.py
python tests/run\_ui\_structure.py
```

Os resultados e as pendências de cada etapa são acompanhados separadamente na documentação interna de desenvolvimento. Os números de testes registrados podem mudar conforme as suítes evoluem; consulte os próprios scripts e o registro de progresso para obter o estado mais recente.

## Estado do desenvolvimento

**Implementado:** banco de questões, configuração, utilitários, armazenamento, validação do banco, motor de jogo, interface-base, menu, configuração de partida solo, fluxo de perguntas e tela de resultados/revisão.

**Em desenvolvimento / etapas futuras:**

* **Campanha:** percurso pelas cinco regiões brasileiras, com progressão própria.
* **Multiplayer local, via Wi-fi/LAN:** partidas entre jogadores, incluindo o modo 1×1; a expectativa atual é de que seja possível por meio da mesma rede de Wi-fi/Lan. Também terá jogabilidade diferente tanto do modo solo, quanto do modo campanha.
* **Integração final:** inicialização e conexão definitiva de todos os módulos, substituindo as ferramentas intermediárias de prévia, que estão disponíveis para testes da fase atual.
* **Personagens para personalização e individualização dos jogadores, com mascotes desbloqueáveis através de marcos (como conquistas da Campanha)
A interface e a arquitetura seguem uma direção **mobile-first**: a experiência deve funcionar bem em telas pequenas e também se adaptar a telas maiores. 
O projeto ainda não deve ser considerado uma versão final. A implementação dos módulos e a validação integrada em navegador e dispositivos continuam fazendo parte do desenvolvimento.

## Documentação

* `docs/UI\_CONTRACT.md` — contrato da interface: telas, identificadores, estados e ações.
* `docs/IDENTIDADE\_VISUAL.md` — referências da identidade visual e dos componentes.
* `docs/ASSET\_CATALOG.md` — catálogo de recursos visuais e sonoros existentes ou planejados.

\---



