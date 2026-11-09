#include "../vendor/dds-reference/include/dll.h"
#include <iostream>
#include <sstream>
#include <string>
#include <cstring>

// Independent native reference. One line: trump first s0 r0 s1 r1 s2 r2 N:...
int main() {
  SetMaxThreads(1);
  std::cerr << "DDS native version " << DDS_VERSION << "\n";
  std::string line;
  while (std::getline(std::cin, line)) {
    dealPBN deal{}; futureTricks result{}; std::istringstream stream(line);
    stream >> deal.trump >> deal.first;
    for (int i = 0; i < 3; ++i) stream >> deal.currentTrickSuit[i] >> deal.currentTrickRank[i];
    std::string pbn; std::getline(stream >> std::ws, pbn);
    if (pbn.size() >= sizeof(deal.remainCards)) return 2;
    std::strcpy(deal.remainCards, pbn.c_str());
    int code = SolveBoardPBN(deal, -1, 3, 1, &result, 0);
    std::cout << "{\"code\":" << code << ",\"cards\":" << result.cards << ",\"nodes\":" << result.nodes;
    const int* arrays[] = {result.suit, result.rank, result.equals, result.score};
    const char* names[] = {"suit", "rank", "equals", "score"};
    for (int n = 0; n < 4; ++n) {
      std::cout << ",\"" << names[n] << "\":[";
      for (int i = 0; i < result.cards; ++i) { if (i) std::cout << ','; std::cout << arrays[n][i]; }
      std::cout << ']';
    }
    std::cout << "}\n" << std::flush;
  }
  FreeMemory();
}
