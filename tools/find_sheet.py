import urllib.request
import re

req = urllib.request.Request("https://docs.google.com/spreadsheets/d/e/2PACX-1vSP5OJpICPPpGYxgeuVcpJdx8nR7LKqLTpDAWBlhLKUgZDafXqZ_tTpa8_1fM1bVHdBYGlorZxfiW8_/pubhtml", headers={'User-Agent': 'Mozilla/5.0'})
response = urllib.request.urlopen(req).read().decode('utf-8')

# Search for the sheet button definitions which contain the ID and Name
# e.g. <li id="sheet-button-61874306"><a href="#">Sheet1</a></li>
matches = re.findall(r'id="sheet-button-(.*?)".*?>(.*?)<', response)
for m in matches:
    print(f"ID: {m[0]} -> Name: {m[1]}")
