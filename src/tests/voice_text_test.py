import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from voice_text import normalize,chunks

class VoiceTextTests(unittest.TestCase):
    def test_dice_and_numbers_are_spoken_instead_of_disappearing(self):
        result=normalize('Бросьте d20 + 3. Сл 12, HP 31.')
        self.assertIn('дэ двадцать плюс три',result)
        self.assertIn('сложность двенадцать',result)
        self.assertIn('здоровье тридцать один',result)
        self.assertNotRegex(result,r'[0-9A-Za-z]')

    def test_fantasy_names_and_markdown_are_readable(self):
        result=normalize('**Theon**: [Проверка](https://example.com) — 14.')
        self.assertIn('теон',result)
        self.assertIn('Проверка',result)
        self.assertIn('четырнадцать',result)
        self.assertNotIn('https',result)

    def test_long_text_is_split_without_losing_words(self):
        text=' '.join(['Старая башня скрывается в тумане.']*60)
        parts=chunks(text)
        self.assertGreater(len(parts),1)
        self.assertTrue(all(len(x)<=340 for x in parts))
        self.assertEqual(' '.join(parts),text)

if __name__=='__main__':unittest.main()
