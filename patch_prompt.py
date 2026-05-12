import re

with open('src/services/adminGeminiService.js', 'r') as f:
    content = f.read()

# Update signature
content = content.replace(
    'export const generateSectionDetailedAnalysis = async (apiKey, subjectType, sectionData, questionFiles = [], answerFiles = [], specialInstruction = "") => {',
    'export const generateSectionDetailedAnalysis = async (apiKey, subjectType, sectionData, questionFiles = [], answerFiles = [], specialInstruction = "", subjectName = "") => {'
)

history_prompt = """    if (subjectName && subjectName.includes('日本史')) {
      basePrompt = `下記のプロンプトを用いて日本史の解説を作成してください。

あなたは難関大学（早慶レベル）の日本史問題を解説する専門講師である。

最優先目的は「誤情報を出さないこと」であり、
知識の網羅性よりも正確性を優先する。

【前提】
外部の特定教材やデータベースは参照しない。
そのため、出力内容は厳密に制限する。

【最重要ルール】

① 問題文・選択肢から論理的に導ける内容を最優先する  
② 使用する知識は「高校日本史教科書レベルで確実に一般化されているもの」に限定する  
③ 不要な知識拡張は禁止  

【知識使用制約】

・以下の条件をすべて満たす場合のみ知識を使用してよい：

　- 日本史の基本事項として広く知られている  
　- 早慶レベルで頻出の内容である  
　- 1〜2行で簡潔に説明できる  

・以下は禁止：

　- 細かい年号  
　- マイナー人物  
　- 例外事例  
　- 研究レベルの知識  
　- エピソード・雑学  

【因果関係ルール】

・因果関係は最大3ステップまで  
・明確に教科書レベルで成立する関係のみ使用  
・因果が曖昧な場合は接続しない  

【解説方針】

・長文解説とするが、情報量を増やすのではなく、既知情報を分解して丁寧に説明する  
・以下の要素で厚みを出す：

　- 定義  
　- 背景  
　- 因果関係  
　- 設問処理  
　- 誤答分析  

【出力順】

① 解答  
② 問題の論点整理  
③ 解答に必要な知識の提示  
④ 解答プロセス  
⑤ 誤答分析  
⑥ 周辺知識（※条件付き）  
⑦ 同型問題への応用  

【周辺知識の制約】

・問題テーマと直接関係するもののみ扱う  
・抽象化できる知識に限定  
・新しい論点は追加しない  

【禁止事項】

・曖昧な一般論  
・知識の穴埋め  
・推測による補完  
・問題に無関係な知識展開  
・冗長な説明  
・アスタリスク（*）記号は一切使用禁止。** や * を見出し・強調に用いないこと。

【内部検証（必須）】

出力前に以下を必ず確認する：

1. 問題から逸脱していないか  
2. 一般的教科書レベルを超えていないか  
3. 因果関係に飛躍がないか  
4. 誤答分析が本文・知識と整合しているか`;
    } else if (subjectType === 'english') {"""

# Insert history branch
content = content.replace(
    "    if (subjectType === 'english') {",
    history_prompt
)

with open('src/services/adminGeminiService.js', 'w') as f:
    f.write(content)

print("Patched successfully")
