"""Prepare narration for Silero's Cyrillic alphabet; never send text off-device."""
import re
import textwrap
from num2words import num2words

SPEAKERS = ('eugene', 'aidar', 'xenia', 'kseniya', 'baya')

def normalize(text):
    text = re.sub(r'```[\s\S]*?```', ' ', str(text))
    text = re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', text)
    text = re.sub(r'https?://\S+', ' ссылка ', text)
    text = text.replace('D&D', 'Подземелья и драконы').replace('DND', 'Подземелья и драконы')
    for pattern, replacement in [(r'\bHP\b', 'здоровье'), (r'\bAC\b', 'класс доспеха'), (r'\bКД\b', 'класс доспеха'), (r'\bDC\b', 'сложность'), (r'\bСл\b', 'сложность')]:
        text = re.sub(pattern, replacement, text, flags=re.I)
    text = re.sub(r'\b(\d*)[dд](\d+)\b', lambda m: (num2words(int(m[1]), lang='ru') + ' ' if m[1] else '') + 'дэ ' + num2words(int(m[2]), lang='ru'), text, flags=re.I)
    text = re.sub(r'([−–-])\s*(?=\d)', ' минус ', text)
    text = text.replace('+', ' плюс ').replace('=', ' равно ').replace('/', ' из ')
    text = re.sub(r'\d+(?:[.,]\d+)?', lambda m: num2words(m[0].replace(',', '.'), lang='ru') if len(m[0]) < 16 else ' '.join(num2words(int(x), lang='ru') for x in m[0] if x.isdigit()), text)
    # Pronounce Latin names instead of silently dropping them. Specific fantasy names
    # can be written in Cyrillic by the player for more accurate pronunciation.
    digraphs = {'shch':'щ','sch':'щ','sh':'ш','ch':'ч','zh':'ж','th':'т','ph':'ф','kh':'х','qu':'кв','ck':'к','oo':'у','ee':'и','ya':'я','yu':'ю','yo':'ё'}
    letters = dict(zip('abcdefghijklmnopqrstuvwxyz', ('а','б','к','д','е','ф','г','х','и','дж','к','л','м','н','о','п','к','р','с','т','у','в','в','кс','й','з')))
    def cyrillic(match):
        word = match[0].lower()
        for a,b in digraphs.items(): word = word.replace(a,b)
        return ''.join(letters.get(c,c) for c in word)
    text = re.sub(r'[A-Za-z]+', cyrillic, text)
    text = re.sub(r'[*_`#<>|~{}\[\]()]', ' ', text)
    text = re.sub(r'[^а-яёА-ЯЁ\s.,!?;:—+\-]', ' ', text)
    return re.sub(r'\s+', ' ', text).strip()

def chunks(text, limit=340):
    result=[]
    for sentence in re.split(r'(?<=[.!?])\s+', text):
        for part in textwrap.wrap(sentence, width=limit, break_long_words=True, break_on_hyphens=False):
            if result and len(result[-1])+len(part)+1 <= limit:
                result[-1] += ' ' + part
            else:
                result.append(part)
    return result
